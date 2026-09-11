"""
Exact CycloneForecaster architecture extracted from the user's notebook.
Inference uses:
  track_history   [B, 12, 12]
  physics_history [B, 12, 22]
Output displacement is [east_km, north_km] for 2..24 h.
"""
from typing import Dict
import torch
import torch.nn as nn


class GatedFeatureFusion(nn.Module):
    def __init__(self, hidden_dim: int):
        super().__init__()
        self.gate = nn.Sequential(
            nn.Linear(hidden_dim * 2, hidden_dim),
            nn.Sigmoid()
        )

    def forward(self, h_track: torch.Tensor, h_physics: torch.Tensor) -> torch.Tensor:
        combined = torch.cat([h_track, h_physics], dim=-1)
        gate = self.gate(combined)
        return gate * h_track + (1.0 - gate) * h_physics


class TrackBranch(nn.Module):
    def __init__(self, track_features: int, hidden_dim: int, dropout: float = 0.1):
        super().__init__()
        self.projection = nn.Sequential(
            nn.Linear(track_features, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_dim, hidden_dim)
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.projection(x)


class PhysicsBranch(nn.Module):
    def __init__(self, physics_features: int, hidden_dim: int, dropout: float = 0.1):
        super().__init__()
        self.projection = nn.Sequential(
            nn.Linear(physics_features, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_dim, hidden_dim)
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.projection(x)


class MultiHorizonDecoder(nn.Module):
    def __init__(self, hidden_dim: int, n_horizons: int,
                 n_heads: int = 4, dropout: float = 0.1):
        super().__init__()
        self.n_horizons = n_horizons
        self.horizon_queries = nn.Parameter(
            torch.randn(1, n_horizons, hidden_dim)
        )
        self.cross_attention = nn.MultiheadAttention(
            embed_dim=hidden_dim,
            num_heads=n_heads,
            dropout=dropout,
            batch_first=True
        )
        self.norm = nn.LayerNorm(hidden_dim)
        self.dropout = nn.Dropout(dropout)

    def forward(self, encoded: torch.Tensor) -> torch.Tensor:
        batch_size = encoded.size(0)
        queries = self.horizon_queries.expand(batch_size, -1, -1)
        attn_output, _ = self.cross_attention(
            query=queries,
            key=encoded,
            value=encoded
        )
        return self.norm(queries + self.dropout(attn_output))


class CycloneForecaster(nn.Module):
    def __init__(self,
                 track_features: int = 12,
                 physics_features: int = 20,
                 hidden_dim: int = 128,
                 n_layers: int = 4,
                 n_heads: int = 8,
                 n_horizons: int = 12,
                 dropout: float = 0.1):
        super().__init__()

        self.n_horizons = n_horizons

        self.track_branch = TrackBranch(
            track_features, hidden_dim, dropout
        )
        self.physics_branch = PhysicsBranch(
            physics_features, hidden_dim, dropout
        )

        self.fusion = GatedFeatureFusion(hidden_dim)

        self.positional_encoding = nn.Parameter(
            torch.randn(1, 100, hidden_dim)
        )

        encoder_layer = nn.TransformerEncoderLayer(
            d_model=hidden_dim,
            nhead=n_heads,
            dim_feedforward=hidden_dim * 4,
            dropout=dropout,
            batch_first=True,
            activation="gelu"
        )
        self.encoder = nn.TransformerEncoder(
            encoder_layer,
            num_layers=n_layers
        )

        self.decoder = MultiHorizonDecoder(
            hidden_dim,
            n_horizons,
            n_heads,
            dropout
        )

        self.displacement_head = nn.Sequential(
            nn.Linear(hidden_dim, hidden_dim // 2),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_dim // 2, 2)
        )

        self.uncertainty_head = nn.Sequential(
            nn.Linear(hidden_dim, hidden_dim // 2),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_dim // 2, 2)
        )

        self.intensity_head = nn.Sequential(
            nn.Linear(hidden_dim, hidden_dim // 2),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_dim // 2, 2)
        )

    def forward(
        self,
        track_history: torch.Tensor,
        physics_history: torch.Tensor
    ) -> Dict[str, torch.Tensor]:

        _, seq_len, _ = track_history.shape

        h_track = self.track_branch(track_history)
        h_physics = self.physics_branch(physics_history)

        h_fused = self.fusion(h_track, h_physics)
        h_fused = h_fused + self.positional_encoding[:, :seq_len, :]

        encoded = self.encoder(h_fused)
        horizon_embeddings = self.decoder(encoded)

        displacement = self.displacement_head(horizon_embeddings)
        uncertainty = self.uncertainty_head(horizon_embeddings)
        intensity = self.intensity_head(horizon_embeddings)

        uncertainty = torch.clamp(
            uncertainty, min=-5, max=5
        )

        return {
            "displacement": displacement,
            "uncertainty": uncertainty,
            "intensity": intensity
        }

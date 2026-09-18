"""CLI entry point for TOOFAN pipeline."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

# CRITICAL: Configure runtime BEFORE any ML framework imports
from src.core.runtime import configure_runtime
configure_runtime()

import yaml

from src.pipeline.orchestrator import (
    PipelineOrchestrator, ModuleName, create_orchestrator
)
from src.core.schema import Basin, RiskLevel


def load_config(config_path: str | Path) -> dict:
    """Load configuration from YAML file."""
    with open(config_path, 'r') as f:
        return yaml.safe_load(f)


def parse_datetime(dt_str: str) -> datetime:
    """Parse datetime string in various formats."""
    for fmt in [
        '%Y-%m-%dT%H:%M:%S',
        '%Y-%m-%d %H:%M:%S',
        '%Y-%m-%dT%H:%M',
        '%Y-%m-%d %H:%M',
        '%Y-%m-%d',
    ]:
        try:
            return datetime.strptime(dt_str, fmt)
        except ValueError:
            continue
    raise ValueError(f"Unable to parse datetime: {dt_str}")


def main():
    parser = argparse.ArgumentParser(
        description='TOOFAN Cyclone Forecasting Pipeline',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Full pipeline
  python -m pipeline.run --storm-id 2024-001 --basin BOB --timestamp 2024-05-20T12:00:00

  # Genesis only
  python -m pipeline.run --storm-id 2024-001 --basin BOB --timestamp 2024-05-20T12:00:00 --module genesis

  # Track only
  python -m pipeline.run --storm-id 2024-001 --basin BOB --timestamp 2024-05-20T12:00:00 --mode track_only

  # Custom config
  python -m pipeline.run --storm-id 2024-001 --basin BOB --timestamp 2024-05-20T12:00:00 --config custom_config.yaml
        """
    )

    parser.add_argument('--storm-id', required=True, help='Storm identifier (e.g., 2024-001)')
    parser.add_argument('--basin', required=True, choices=[b.value for b in Basin],
                        help='Ocean basin')
    parser.add_argument('--timestamp', required=True,
                        help='Forecast initialization time (YYYY-MM-DDTHH:MM:SS)')
    parser.add_argument('--config', default='configs/pipeline.yaml',
                        help='Path to configuration file')
    parser.add_argument('--mode', choices=['full', 'genesis_only', 'track_only', 'hazard_only'],
                        default='full', help='Execution mode')
    parser.add_argument('--module', choices=[m.value for m in ModuleName],
                        help='Run single module only')
    parser.add_argument('--output', help='Output file path (JSON)')
    parser.add_argument('--output-dir', default='outputs',
                        help='Output directory for structured outputs')
    parser.add_argument('--verbose', '-v', action='store_true', help='Verbose output')
    parser.add_argument('--dry-run', action='store_true', help='Validate config without executing')

    args = parser.parse_args()

    # Load config
    try:
        config = load_config(args.config)
    except Exception as e:
        print(f"Error loading config: {e}", file=sys.stderr)
        sys.exit(1)

    # Parse timestamp
    try:
        reference_time = parse_datetime(args.timestamp)
    except ValueError as e:
        print(f"Error parsing timestamp: {e}", file=sys.stderr)
        sys.exit(1)

    # Determine modules
    modules = None
    if args.module:
        modules = [ModuleName(args.module)]
        mode = "custom"
    else:
        mode = args.mode

    if args.dry_run:
        print("Configuration loaded successfully")
        print(f"Storm: {args.storm_id}")
        print(f"Basin: {args.basin}")
        print(f"Time: {reference_time}")
        print(f"Mode: {mode}")
        print(f"Modules: {[m.value for m in modules] if modules else 'all'}")
        return

    # Create orchestrator
    try:
        orchestrator = create_orchestrator(config)
    except Exception as e:
        print(f"Error creating orchestrator: {e}", file=sys.stderr)
        sys.exit(1)

    # Execute pipeline
    try:
        print(f"Starting TOOFAN pipeline for {args.storm_id} at {reference_time}")
        result = orchestrator.execute(
            storm_id=args.storm_id,
            basin=args.basin,
            reference_time=reference_time,
            modules=modules,
            mode=mode
        )

        # Print summary
        summary = orchestrator.get_execution_summary()
        print("\n=== EXECUTION SUMMARY ===")
        print(f"Modules executed: {summary['modules_executed']}")
        print(f"Modules failed: {summary['modules_failed']}")
        print(f"Total time: {summary['total_time']:.2f}s")
        print(f"Overall hazard: {result.overall_hazard_severity.value if result.overall_hazard_severity else 'N/A'}")
        print(f"Overall confidence: {result.confidence:.2%}")

        if result.affected_region:
            print(f"Affected region: {result.affected_region.get('radius_km', 0):.0f} km radius")

        # Save output
        output_path = Path(args.output) if args.output else None
        if output_path is None:
            output_dir = Path(args.output_dir) / args.storm_id / reference_time.strftime('%Y%m%dT%H%M%S')
            output_dir.mkdir(parents=True, exist_ok=True)
            output_path = output_dir / 'unified_forecast.json'

        # Convert to serializable dict
        output_dict = result.model_dump(mode='json') if hasattr(result, 'model_dump') else result.__dict__
        with open(output_path, 'w') as f:
            json.dump(output_dict, f, indent=2, default=str)

        print(f"\nOutput saved to: {output_path}")

    except Exception as e:
        print(f"Pipeline execution failed: {e}", file=sys.stderr)
        if args.verbose:
            import traceback
            traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
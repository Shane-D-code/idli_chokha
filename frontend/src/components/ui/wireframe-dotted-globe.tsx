"use client"

import { useEffect, useRef, useState } from "react"
import * as d3 from "d3"
import type { LatLon } from '../../types/common'

export interface GlobeOverlay {
  /** Current cyclone position — always visible (projection handles clip). */
  current: LatLon
  currentColor?: string
  /** Observed history, oldest → newest (ends at current position). */
  observed: LatLon[]
  /** Forecast positions, +6H → +72H. */
  forecast: LatLon[]
  forecastColors?: string[]
}

interface RotatingEarthProps {
  width?: number
  height?: number
  className?: string
  overlay?: GlobeOverlay
}

export default function RotatingEarth({ width = 800, height = 600, className = "", overlay }: RotatingEarthProps) {
  const overlayRef = useRef<GlobeOverlay | undefined>(overlay)
  useEffect(() => {
    overlayRef.current = overlay
  }, [overlay])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return

    const context = canvas.getContext("2d")
    if (!context) return

    const dpr = window.devicePixelRatio || 1

    // Size the canvas to fit its container, bounded by the requested props.
    // A square canvas keeps the orthographic globe perfectly round in any column.
    let containerWidth = Math.min(width, height, window.innerWidth - 40, wrap.clientWidth)
    let containerHeight = containerWidth
    let radius = containerWidth / 2.5

    // Create projection and path generator for Canvas
    const projection = d3
      .geoOrthographic()
      .scale(radius)
      .translate([containerWidth / 2, containerHeight / 2])
      .clipAngle(90)

    const path = d3.geoPath().projection(projection).context(context)

    const pointInPolygon = (point: [number, number], polygon: number[][]): boolean => {
      const [x, y] = point
      let inside = false

      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xi, yi] = polygon[i]
        const [xj, yj] = polygon[j]

        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
          inside = !inside
        }
      }

      return inside
    }

    const pointInFeature = (point: [number, number], feature: any): boolean => {
      const geometry = feature.geometry

      if (geometry.type === "Polygon") {
        const coordinates = geometry.coordinates
        // Check if point is in outer ring
        if (!pointInPolygon(point, coordinates[0])) {
          return false
        }
        // Check if point is in any hole (inner rings)
        for (let i = 1; i < coordinates.length; i++) {
          if (pointInPolygon(point, coordinates[i])) {
            return false // Point is in a hole
          }
        }
        return true
      } else if (geometry.type === "MultiPolygon") {
        // Check each polygon in the MultiPolygon
        for (const polygon of geometry.coordinates) {
          // Check if point is in outer ring
          if (pointInPolygon(point, polygon[0])) {
            // Check if point is in any hole
            let inHole = false
            for (let i = 1; i < polygon.length; i++) {
              if (pointInPolygon(point, polygon[i])) {
                inHole = true
                break
              }
            }
            if (!inHole) {
              return true
            }
          }
        }
        return false
      }

      return false
    }

    const generateDotsInPolygon = (feature: any, dotSpacing = 16) => {
      const dots: [number, number][] = []
      const bounds = d3.geoBounds(feature)
      const [[minLng, minLat], [maxLng, maxLat]] = bounds

      const stepSize = dotSpacing * 0.08
      let pointsGenerated = 0

      for (let lng = minLng; lng <= maxLng; lng += stepSize) {
        for (let lat = minLat; lat <= maxLat; lat += stepSize) {
          const point: [number, number] = [lng, lat]
          if (pointInFeature(point, feature)) {
            dots.push(point)
            pointsGenerated++
          }
        }
      }

      console.log(
        `[v0] Generated ${pointsGenerated} points for land feature:`,
        feature.properties?.featurecla || "Land",
      )
      return dots
    }

    interface DotData {
      lng: number
      lat: number
      visible: boolean
    }

    const allDots: DotData[] = []
    let landFeatures: any

    // Set up rotation and interaction
    const rotation: [number, number] = overlayRef.current
      ? [-overlayRef.current.current.lon, -overlayRef.current.current.lat]
      : [0, 0]
    let autoRotate = true
    const rotationSpeed = 0.12

    /* True for a point on the near-side hemisphere visible from the orthographic view. */
    const isOnFront = (lon: number, lat: number): boolean => {
      const [rλ, rφ] = rotation
      const cLon = ((-rλ) * Math.PI) / 180
      const cLat = ((-rφ) * Math.PI) / 180
      const pLon = (lon * Math.PI) / 180
      const pLat = (lat * Math.PI) / 180
      const cosC =
        Math.sin(cLat) * Math.sin(pLat) + Math.cos(cLat) * Math.cos(pLat) * Math.cos(pLon - cLon)
      return cosC >= 0
    }

    /* Cyclone overlay — observed + forecast track and the live marker, drawn
       through the SAME orthographic projection as the globe so the cyclone
       always sits at its real lat/lon. */
    const drawOverlay = (s: number) => {
      const ov = overlayRef.current
      if (!ov) return

      const strokeSegs = (pts: [number, number][], color: string, width: number, dash: number[]) => {
        context.beginPath()
        context.strokeStyle = color
        context.lineWidth = width * s
        context.setLineDash(dash)
        let penDown = false
        for (const [lon, lat] of pts) {
          if (!isOnFront(lon, lat)) {
            penDown = false
            continue
          }
          const p = projection([lon, lat])
          if (!p) {
            penDown = false
            continue
          }
          if (!penDown) {
            context.moveTo(p[0], p[1])
            penDown = true
          } else {
            context.lineTo(p[0], p[1])
          }
        }
        context.stroke()
        context.setLineDash([])
      }

      const observed: [number, number][] = [...ov.observed.map((p) => [p.lon, p.lat] as [number, number]), [ov.current.lon, ov.current.lat] as [number, number]]
      const forecast: [number, number][] = [[ov.current.lon, ov.current.lat] as [number, number], ...ov.forecast.map((p) => [p.lon, p.lat] as [number, number])]

      // observed history — thin pale line
      strokeSegs(observed, "rgba(156,207,226,0.55)", 1.4, [6, 5])
      // forecast — dashed coral
      strokeSegs(forecast, "rgba(232,76,76,0.85)", 1.6, [8, 6])

      // forecast points
      ov.forecast.forEach((p, i) => {
        if (!isOnFront(p.lon, p.lat)) return
        const pp = projection([p.lon, p.lat])
        if (!pp) return
        context.beginPath()
        context.arc(pp[0], pp[1], 3 * s, 0, 2 * Math.PI)
        context.fillStyle = ov.forecastColors?.[i] ?? "#e2604f"
        context.fill()
        context.strokeStyle = "#000"
        context.lineWidth = 0.8 * s
        context.stroke()
      })

      // current cyclone marker — pulsing ring + core
      if (isOnFront(ov.current.lon, ov.current.lat)) {
        const p = projection([ov.current.lon, ov.current.lat])
        if (p) {
          const t = Date.now() / 1000
          const pulse = 1 + 0.12 * Math.sin(t * 2.4)
          context.beginPath()
          context.arc(p[0], p[1], 9 * s * pulse, 0, 2 * Math.PI)
          context.strokeStyle = ov.currentColor ?? "#e84c4c"
          context.lineWidth = 1.8 * s
          context.stroke()
          context.beginPath()
          context.arc(p[0], p[1], 5 * s, 0, 2 * Math.PI)
          context.fillStyle = ov.currentColor ?? "#e84c4c"
          context.fill()
          context.strokeStyle = "#000"
          context.lineWidth = 1 * s
          context.stroke()
        }
      }
    }

    const render = () => {
      // Clear canvas
      context.clearRect(0, 0, containerWidth, containerHeight)

      const currentScale = projection.scale()
      const scaleFactor = currentScale / radius

      // Draw ocean (globe background)
      context.beginPath()
      context.arc(containerWidth / 2, containerHeight / 2, currentScale, 0, 2 * Math.PI)
      context.fillStyle = "#000000"
      context.fill()
      context.strokeStyle = "#ffffff"
      context.lineWidth = 2 * scaleFactor
      context.stroke()

      if (landFeatures) {
        // Draw graticule
        const graticule = d3.geoGraticule()
        context.beginPath()
        path(graticule())
        context.strokeStyle = "#ffffff"
        context.lineWidth = 1 * scaleFactor
        context.globalAlpha = 0.25
        context.stroke()
        context.globalAlpha = 1

        // Draw land outlines
        context.beginPath()
        landFeatures.features.forEach((feature: any) => {
          path(feature)
        })
        context.strokeStyle = "#ffffff"
        context.lineWidth = 1 * scaleFactor
        context.stroke()

        // Draw halftone dots
        allDots.forEach((dot) => {
          const projected = projection([dot.lng, dot.lat])
          if (
            projected &&
            projected[0] >= 0 &&
            projected[0] <= containerWidth &&
            projected[1] >= 0 &&
            projected[1] <= containerHeight
          ) {
            context.beginPath()
            context.arc(projected[0], projected[1], 1.2 * scaleFactor, 0, 2 * Math.PI)
            context.fillStyle = "#999999"
            context.fill()
          }
        })
      }

      drawOverlay(scaleFactor)
    }

    const setup = () => {
      containerWidth = Math.max(1, Math.min(width, height, window.innerWidth - 40, wrap.clientWidth))
      containerHeight = containerWidth
      radius = containerWidth / 2.5

      canvas.width = Math.round(containerWidth * dpr)
      canvas.height = Math.round(containerHeight * dpr)
      canvas.style.width = `${containerWidth}px`
      canvas.style.height = `${containerHeight}px`
      context.setTransform(dpr, 0, 0, dpr, 0, 0)

      projection.scale(radius).translate([containerWidth / 2, containerHeight / 2])
      render()
    }

    const loadWorldData = async () => {
      try {
        setIsLoading(true)

        const response = await fetch(
          "https://raw.githubusercontent.com/martynafford/natural-earth-geojson/refs/heads/master/110m/physical/ne_110m_land.json",
        )
        if (!response.ok) throw new Error("Failed to load land data")

        landFeatures = await response.json()

        // Generate dots for all land features
        let totalDots = 0
        landFeatures.features.forEach((feature: any) => {
          const dots = generateDotsInPolygon(feature, 16)
          dots.forEach(([lng, lat]) => {
            allDots.push({ lng, lat, visible: true })
            totalDots++
          })
        })

        console.log(`[v0] Total dots generated: ${totalDots} across ${landFeatures.features.length} land features`)

        render()
        setIsLoading(false)
      } catch {
        setError("Failed to load land map data")
        setIsLoading(false)
      }
    }

    const rotate = () => {
      if (autoRotate) {
        rotation[0] += rotationSpeed
        projection.rotate(rotation)
        render()
      }
    }

    // Auto-rotation timer
    const rotationTimer = d3.timer(rotate)

    const handleMouseDown = (event: MouseEvent) => {
      autoRotate = false
      const startX = event.clientX
      const startY = event.clientY
      const startRotation: [number, number] = [rotation[0], rotation[1]]

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const sensitivity = 0.5
        const dx = moveEvent.clientX - startX
        const dy = moveEvent.clientY - startY

        rotation[0] = startRotation[0] + dx * sensitivity
        rotation[1] = startRotation[1] - dy * sensitivity
        rotation[1] = Math.max(-90, Math.min(90, rotation[1]))

        projection.rotate(rotation)
        render()
      }

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove)
        document.removeEventListener("mouseup", handleMouseUp)

        setTimeout(() => {
          autoRotate = true
        }, 10)
      }

      document.addEventListener("mousemove", handleMouseMove)
      document.addEventListener("mouseup", handleMouseUp)
    }

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()
      const scaleFactor = event.deltaY > 0 ? 0.9 : 1.1
      const newRadius = Math.max(radius * 0.5, Math.min(radius * 3, projection.scale() * scaleFactor))
      projection.scale(newRadius)
      render()
    }

    canvas.addEventListener("mousedown", handleMouseDown)
    canvas.addEventListener("wheel", handleWheel)

    // Fit to the container and keep in sync with resizes
    setup()
    const resizeObserver = new ResizeObserver(setup)
    resizeObserver.observe(wrap)

    // Load the world data
    loadWorldData()

    // Cleanup
    return () => {
      rotationTimer.stop()
      resizeObserver.disconnect()
      canvas.removeEventListener("mousedown", handleMouseDown)
      canvas.removeEventListener("wheel", handleWheel)
    }
  }, [width, height])

  if (error) {
    return (
      <div className={`dark flex items-center justify-center bg-card rounded-2xl p-8 ${className}`}>
        <div className="text-center">
          <p className="dark text-destructive font-semibold mb-2">Error loading Earth visualization</p>
          <p className="dark text-muted-foreground text-sm">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div ref={wrapRef} className={`dark relative aspect-square w-full ${className}`}>
      <canvas
        ref={canvasRef}
        className="h-full w-full rounded-2xl bg-background dark"
        style={{ maxWidth: "100%" }}
      />
      {isLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-background">
          <p className="text-sm text-muted-foreground animate-pulse">Loading globe…</p>
        </div>
      )}
      <div className="absolute bottom-4 left-4 z-10 text-xs text-muted-foreground px-2 py-1 rounded-md bg-neutral-900">
        Drag to rotate • Scroll to zoom
      </div>
    </div>
  )
}
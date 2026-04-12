import { useState, useRef, useEffect, useCallback } from 'react'
import { MapContainer, TileLayer, Marker, useMapEvents, ZoomControl } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { ReactPhotoSphereViewer } from 'react-photo-sphere-viewer'
import Anthropic from '@anthropic-ai/sdk'
import './App.css'

// Fix Leaflet's default icon path issue with Vite bundler
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

const pinIcon = L.divIcon({
  className: '',
  html: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="42" viewBox="0 0 32 42">
    <path d="M16 0C7.163 0 0 7.163 0 16c0 10 16 26 16 26S32 26 32 16C32 7.163 24.837 0 16 0z"
      fill="#607845" stroke="white" stroke-width="2"/>
    <circle cx="16" cy="16" r="6" fill="white"/>
  </svg>`,
  iconSize: [32, 42],
  iconAnchor: [16, 42],
})

const SKYBOX_API_KEY = import.meta.env.VITE_SKYBOX_API_KEY as string

interface LatLng {
  lat: number
  lng: number
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] }
  properties: {
    name?: string
    city?: string
    state?: string
    country?: string
    type?: string
  }
}

async function buildPromptWithClaude(lat: number, lng: number): Promise<string> {
  const client = new Anthropic({
    apiKey: import.meta.env.VITE_ANTHROPIC_API_KEY as string,
    dangerouslyAllowBrowser: true,
  })
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 256,
    messages: [
      {
        role: 'user',
        content: `You are a prompt engineer specializing in 360° image generation. Given the coordinates Lat: ${lat}, Long: ${lng}, write a single detailed sentence describing the exact real-world location and its surroundings — including architecture, street environment, vegetation, and atmosphere — to be used as a generation prompt for a photorealistic 360° street-level panorama. Limit your response to 100 words.`,
      },
    ],
  })
  const block = message.content[0]
  return block.type === 'text' ? block.text.trim() : `location at ${lat}, ${lng}`
}

async function generateSkybox(prompt: string): Promise<string> {
  const createRes = await fetch('https://backend.blockadelabs.com/api/v1/skybox', {
    method: 'POST',
    headers: { 'x-api-key': SKYBOX_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ skybox_style_id: 67, prompt }),
  })
  if (!createRes.ok) throw new Error('Failed to start Skybox generation')
  const { id } = await createRes.json()

  while (true) {
    await new Promise((r) => setTimeout(r, 3000))
    const pollRes = await fetch(
      `https://backend.blockadelabs.com/api/v1/imagine/requests/${id}`,
      { headers: { 'x-api-key': SKYBOX_API_KEY } }
    )
    if (!pollRes.ok) throw new Error('Failed to poll Skybox status')
    const data = await pollRes.json()
    const request = data.request ?? data
    if (request.status === 'complete') return request.file_url
    if (request.status === 'error') throw new Error('Skybox generation failed')
  }
}

function GeolocationButton({ onLocate, mapRef }: { onLocate: (pos: LatLng) => void; mapRef: React.RefObject<L.Map | null> }) {
  function handleLocate() {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords
        onLocate({ lat, lng })
        mapRef.current?.flyTo([lat, lng], 15)
      },
      () => alert('Unable to retrieve your location.')
    )
  }

  return (
    <button className="locate-btn" onClick={handleLocate} title="Go to my location">
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
        <circle cx="12" cy="12" r="8" strokeDasharray="2 4"/>
      </svg>
    </button>
  )
}

function DragDropMarker({
  position,
  onDrop,
}: {
  position: LatLng | null
  onDrop: (pos: LatLng) => void
}) {
  useMapEvents({
    click(e) {
      onDrop({ lat: e.latlng.lat, lng: e.latlng.lng })
    },
  })

  if (!position) return null

  return (
    <Marker
      position={[position.lat, position.lng]}
      icon={pinIcon}
      draggable
      eventHandlers={{
        dragend(e) {
          const pos = e.target.getLatLng()
          onDrop({ lat: pos.lat, lng: pos.lng })
        },
      }}
    />
  )
}

function SearchBar({ onSelect }: { onSelect: (pos: LatLng) => void }) {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<PhotonFeature[]>([])
  const [activeIndex, setActiveIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchSuggestions = useCallback(async (q: string) => {
    // Lat/lng passthrough
    const parts = q.split(',').map(s => parseFloat(s.trim()))
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      setSuggestions([])
      return
    }
    if (q.length < 2) { setSuggestions([]); return }
    const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5`)
    const data = await res.json()
    setSuggestions(data.features ?? [])
    setActiveIndex(-1)
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchSuggestions(query), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, fetchSuggestions])

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setSuggestions([])
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function selectFeature(f: PhotonFeature) {
    const [lng, lat] = f.geometry.coordinates
    onSelect({ lat, lng })
    setQuery('')
    setSuggestions([])
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (activeIndex >= 0 && suggestions[activeIndex]) {
      selectFeature(suggestions[activeIndex])
      return
    }
    const parts = query.split(',').map(s => parseFloat(s.trim()))
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      onSelect({ lat: parts[0], lng: parts[1] })
      setQuery('')
      setSuggestions([])
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(i => Math.min(i + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(i => Math.max(i - 1, -1))
    } else if (e.key === 'Escape') {
      setSuggestions([])
    }
  }

  function labelFor(f: PhotonFeature) {
    const p = f.properties
    const primary = p.name ?? p.city ?? p.country ?? 'Unknown'
    const secondary = [p.city, p.state, p.country].filter(Boolean).join(', ')
    return { primary, secondary: secondary === primary ? '' : secondary }
  }

  return (
    <div className="header-search" ref={containerRef}>
      <form onSubmit={handleSubmit}>
        <div className="header-search-inner">
          <svg className="search-icon" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            className="header-search-input"
            placeholder="Search..."
            autoComplete="off"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
      </form>
      {suggestions.length > 0 && (
        <ul className="search-dropdown">
          {suggestions.map((f, i) => {
            const { primary, secondary } = labelFor(f)
            return (
              <li
                key={i}
                className={`search-suggestion${i === activeIndex ? ' active' : ''}`}
                onMouseDown={() => selectFeature(f)}
              >
                <span className="suggestion-primary">{primary}</span>
                {secondary && <span className="suggestion-secondary">{secondary}</span>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default function App() {
  const [markerPos, setMarkerPos] = useState<LatLng | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [panoramaUrl, setPanoramaUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function handleSearchSelect(pos: LatLng) {
    setMarkerPos(pos)
    mapRef.current?.flyTo([pos.lat, pos.lng], 15)
  }

  async function handleVisualize() {
    if (!markerPos) return
    setIsLoading(true)
    setError(null)
    try {
      const prompt = await buildPromptWithClaude(markerPos.lat, markerPos.lng)
      console.log('Skybox prompt:', prompt)
      const url = await generateSkybox(prompt)
      setPanoramaUrl(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="app">
      <header className="header">
        <img src="/geoforge logo.svg" alt="Geoforge" className="header-logo" />
        <h1 onClick={() => window.location.reload()} style={{ cursor: 'pointer' }}>Geoforge Visualizer</h1>
        <SearchBar onSelect={handleSearchSelect} />
      </header>

      <div className="map-wrapper">
        <MapContainer
          ref={mapRef}
          center={[51.505, -0.09]}
          zoom={13}
          zoomControl={false}
          style={{ width: '100%', height: '100%' }}
        >
          <ZoomControl position="bottomright" />
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <DragDropMarker position={markerPos} onDrop={setMarkerPos} />
        </MapContainer>

        <GeolocationButton onLocate={setMarkerPos} mapRef={mapRef} />

        <div className="info-panel">
          <div className="info-panel-title">Location</div>
          {markerPos ? (
            <>
              <div className="info-row">
                <div className="info-col">
                  <span className="info-label">latitude</span>
                  <span className="info-value">{markerPos.lat.toFixed(6)}</span>
                </div>
                <div className="info-col">
                  <span className="info-label">longitude</span>
                  <span className="info-value">{markerPos.lng.toFixed(6)}</span>
                </div>
              </div>
              <div className="visualize-divider" />
              {error && <p className="info-error">{error}</p>}
              <button
                className="visualize-btn"
                onClick={handleVisualize}
                disabled={isLoading}
              >
                {isLoading ? (
                  <span className="btn-loading">
                    <span className="spinner" /> Generating…
                  </span>
                ) : (
                  'Click to visualize'
                )}
              </button>
            </>
          ) : (
            <p className="info-empty">Click anywhere on the map to start visualizing.</p>
          )}
        </div>

        {panoramaUrl && (
          <div className="panorama-overlay">
            <button className="panorama-close" onClick={() => setPanoramaUrl(null)}>✕</button>
            <ReactPhotoSphereViewer
              src={panoramaUrl}
              height="100%"
              width="100%"
              defaultZoomLvl={0}
            />
          </div>
        )}
      </div>
    </div>
  )
}

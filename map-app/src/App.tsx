import { useState, useRef } from 'react'
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
        //content: `Given the coordinates Lat: ${lat}, Long: ${lng}, write a single detailed sentence describing the exact real-world location and its surroundings. Limit your response to 100 words.`,
        //content: `Given the coordinates Lat: ${lat}, Long: ${lng}, write a single detailed sentence describing the exact real-world location and its surroundings to be used as a generation prompt for a photorealistic 360° street-level panorama visualization. Limit your response to 100 words.`,
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

  // Poll until complete
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

export default function App() {
  const [markerPos, setMarkerPos] = useState<LatLng | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [panoramaUrl, setPanoramaUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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
        <h1>Geoforge Visualizer</h1>
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

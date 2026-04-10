import { useState } from 'react'
import { MapContainer, TileLayer, Marker, useMapEvents, ZoomControl } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { ReactPhotoSphereViewer } from 'react-photo-sphere-viewer'
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

async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { 'Accept-Language': 'en' } }
    )
    const data = await res.json()
    const { city, town, village, country } = data.address ?? {}
    const place = city ?? town ?? village ?? country ?? 'unknown location'
    return `${place}, ${country ?? ''}`.trim().replace(/,$/, '')
  } catch {
    return 'a scenic location'
  }
}

async function generateSkybox(prompt: string): Promise<string> {
  const createRes = await fetch('https://backend.blockadelabs.com/api/v1/skybox', {
    method: 'POST',
    headers: { 'x-api-key': SKYBOX_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ skybox_style_id: 2, prompt }),
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
  const [isLoading, setIsLoading] = useState(false)
  const [panoramaUrl, setPanoramaUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleVisualize() {
    if (!markerPos) return
    setIsLoading(true)
    setError(null)
    try {
      const location = await reverseGeocode(markerPos.lat, markerPos.lng)
      const prompt = `Photorealistic 360° street-level view from ${location}, natural lighting, high detail`
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

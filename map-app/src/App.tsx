import { useState } from 'react'
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
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

const personIcon = L.divIcon({
  className: '',
  html: `<div class="person-icon">🧍</div>`,
  iconSize: [40, 40],
  iconAnchor: [20, 40],
})

interface LatLng {
  lat: number
  lng: number
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
      icon={personIcon}
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

  return (
    <div className="app">
      <header className="header">
        <h1>Geoforge Visualizer</h1>
        <p>
          {markerPos
            ? 'Drag the person to reposition.'
            : 'Click anywhere on the map to place a person.'}
        </p>
      </header>

      <div className="map-wrapper">
        <MapContainer
          center={[51.505, -0.09]}
          zoom={13}
          style={{ width: '100%', height: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <DragDropMarker position={markerPos} onDrop={setMarkerPos} />
        </MapContainer>
      </div>

      {markerPos && (
        <div className="info-panel">
          <span className="label">Coordinates</span>
          <span className="coords">
            {markerPos.lat.toFixed(5)}, {markerPos.lng.toFixed(5)}
          </span>
        </div>
      )}
    </div>
  )
}

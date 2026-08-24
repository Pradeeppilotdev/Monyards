import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import Lanyard from './Lanyard'
import Silk from './Silk'
import { FRONT_IMAGE, BACK_IMAGE, isPlaceholder } from './placeholders'
import backCard from './assets/back-card.svg'
import { stageCamera } from './camera'
import './style.css'

const frontImage = isPlaceholder(FRONT_IMAGE) ? null : FRONT_IMAGE
// The back face defaults to the Monad back-card design. If a mint bakes a
// custom back image, the token override wins.
const backImage = isPlaceholder(BACK_IMAGE) ? backCard : BACK_IMAGE

function Stage() {
  // Framed once per load — remounting the physics scene on resize isn't
  // worth it; this targets the viewing device's actual screen.
  const [cam] = useState(() => stageCamera())
  return <Lanyard position={cam} gravity={[0, -40, 0]} fov={26} frontImage={frontImage} backImage={backImage} imageFit="cover" lanyardWidth={0.78} />
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <div className="silk-bg" aria-hidden>
      <Silk color="#7325B5" speed={5} scale={1} noiseIntensity={1.5} rotation={0} />
    </div>
    <Stage />
    <div className="hint">drag the card to interact</div>
  </React.StrictMode>,
)

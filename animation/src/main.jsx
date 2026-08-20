import React from 'react'
import ReactDOM from 'react-dom/client'
import Lanyard from './Lanyard'
import { FRONT_IMAGE, BACK_IMAGE, isPlaceholder } from './placeholders'
import backCard from './assets/back-card.svg'
import './style.css'

const frontImage = isPlaceholder(FRONT_IMAGE) ? null : FRONT_IMAGE
// The back face defaults to the Monad back-card design. If a mint bakes a
// custom back image, the token override wins.
const backImage = isPlaceholder(BACK_IMAGE) ? backCard : BACK_IMAGE

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Lanyard
      position={[0, 0, 20]}
      gravity={[0, -40, 0]}
      fov={26}
      frontImage={frontImage}
      backImage={backImage}
      imageFit="cover"
      lanyardWidth={0.5}
    />
    <div className="hint">drag the card to interact</div>
  </React.StrictMode>
)
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { App } from "./App"
import { ProjectionOutput } from "./components/ProjectionOutput"

import "./index.css"

// the projector window loads this same page with #output and shows only the picture
const isOutput = window.location.hash === "#output"

createRoot(document.getElementById("root") as HTMLElement).render(
	<StrictMode>{isOutput ? <ProjectionOutput /> : <App />}</StrictMode>,
)

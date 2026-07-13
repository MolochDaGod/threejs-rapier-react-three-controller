import { createRoot } from "react-dom/client";
import App from "./App";
import { AppShell } from "./auth/ClerkSetup";
import { captureSsoFromUrl } from "./auth/fleetCore";
import "./index.css";

// Fleet SSO handoff (gameopen / Grudge ID / launcher) before React mounts.
captureSsoFromUrl();

createRoot(document.getElementById("root")!).render(<AppShell home={<App />} />);

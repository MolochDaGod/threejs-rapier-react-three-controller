import { createRoot } from "react-dom/client";
import App from "./App";
import { AppShell } from "./auth/ClerkSetup";
import "./index.css";

createRoot(document.getElementById("root")!).render(<AppShell home={<App />} />);

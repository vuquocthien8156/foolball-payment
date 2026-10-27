import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { AuthProvider } from "./contexts/AuthContext";
import { PWAInstallProvider } from "./contexts/PWAInstallContext";


createRoot(document.getElementById("root")!).render(
  <AuthProvider>
    <PWAInstallProvider>
      <App />
    </PWAInstallProvider>
  </AuthProvider>
);

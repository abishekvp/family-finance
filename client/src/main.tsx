import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./context/AuthContext";
import { ThemeProvider } from "./lib/theme";
import { InstallProvider } from "./lib/install";
import { ToastProvider } from "./components/ui";
import { Aurora } from "./components/Aurora";
import { registerServiceWorker } from "./lib/registerSW";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <InstallProvider>
        <ToastProvider>
          <Aurora />
          <BrowserRouter>
            <AuthProvider>
              <App />
            </AuthProvider>
          </BrowserRouter>
        </ToastProvider>
      </InstallProvider>
    </ThemeProvider>
  </React.StrictMode>
);

registerServiceWorker();

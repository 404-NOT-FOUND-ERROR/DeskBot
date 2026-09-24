import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { DeskBotApp } from "./deskbot/DeskBotApp.tsx";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");

const params = new URLSearchParams(window.location.search);
const isDeskBotMode = params.get("mode") === "deskbot";
const RootApp = isDeskBotMode ? DeskBotApp : App;
if (isDeskBotMode) document.title = "DeskBot - 聚形域世界观测台";

createRoot(container).render(
  <StrictMode>
    <RootApp />
  </StrictMode>,
);

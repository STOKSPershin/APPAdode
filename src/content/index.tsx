import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import ContentApp from "./ContentApp";
import "./content.css";

// Prevent double-injection
if (!document.getElementById("topic-hunter-root")) {
  const container = document.createElement("div");
  container.id = "topic-hunter-root";
  document.body.appendChild(container);

  createRoot(container).render(
    <StrictMode>
      <ContentApp />
    </StrictMode>,
  );

  console.log("[TopicHunter] Content script injected on", location.hostname);
}

// Listen for TOGGLE_PANEL from service worker
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "TOGGLE_PANEL") {
    window.dispatchEvent(new CustomEvent("topichunter-toggle"));
  }
  if (message.type === "RUN_SCAN_QUEUE") {
    window.dispatchEvent(new CustomEvent("topichunter-run-queue"));
  }
});

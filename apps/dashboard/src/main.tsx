import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ApiClient, readSessionToken } from "./api/client";
import { App, MissingToken } from "./App";
import "./styles/index.css";

const token = readSessionToken();
const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<StrictMode>{token ? <App api={new ApiClient({ token })} /> : <MissingToken />}</StrictMode>);
}

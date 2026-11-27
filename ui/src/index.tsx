import { render } from "@solidjs/web";
import "@fontsource-variable/inter";
import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/jetbrains-mono";
import "./styles/fd.css";
import "./styles/app.css";
import App from "./App.tsx";

render(() => <App />, document.getElementById("root")!);

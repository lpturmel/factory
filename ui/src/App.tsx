import { lazy } from "solid-js";
import { createRouter } from "@solidjs/router";
import { LiveProvider, ThemeProvider } from "./data/live.tsx";
import { Shell } from "./components/shell.tsx";
import { NotFound } from "./components/states.tsx";

export const Router = createRouter({
  routes: [
    { path: "/", component: lazy(() => import("./screens/Overview.tsx")) },
    { path: "/f/:name", component: lazy(() => import("./screens/Factory.tsx")) },
    { path: "/f/:name/j/:id", component: lazy(() => import("./screens/Job.tsx")) },
    { path: "*404", component: () => <NotFound what="This page" /> },
  ],
});

export default function App() {
  return (
    <ThemeProvider>
      <LiveProvider>
        <Router>{(props) => <Shell pathname={props.location.pathname}>{props.children}</Shell>}</Router>
      </LiveProvider>
    </ThemeProvider>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { OrbitalElements3D } from "@/lib/types";
import { Vec3, orbitPath, positionAtFraction, toSceneUnits } from "@/lib/orbitGeometry";
import { getGlobeTheme, severityHexFromVar } from "@/lib/theme";

/** Procedurally paints a stylized instrument-panel earth texture — no network fetch. */
function buildEarthTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;

  // base ocean gradient
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, "#17181c");
  grad.addColorStop(0.5, "#101014");
  grad.addColorStop(1, "#09090b");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // scattered stylized landmasses — abstract blobs, not real geography,
  // intentionally so nobody mistakes this for a claim of imagery accuracy
  ctx.fillStyle = "#232327";
  const blobs = 22;
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < blobs; i++) {
    const cx = rand() * canvas.width;
    const cy = 60 + rand() * (canvas.height - 120);
    const rw = 30 + rand() * 90;
    const rh = 18 + rand() * 50;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rw, rh, rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  // latitude/longitude graticule — instrument-panel signature
  ctx.strokeStyle = "rgba(155, 157, 166, 0.22)";
  ctx.lineWidth = 1;
  for (let lat = 0; lat <= canvas.height; lat += canvas.height / 9) {
    ctx.beginPath();
    ctx.moveTo(0, lat);
    ctx.lineTo(canvas.width, lat);
    ctx.stroke();
  }
  for (let lon = 0; lon <= canvas.width; lon += canvas.width / 18) {
    ctx.beginPath();
    ctx.moveTo(lon, 0);
    ctx.lineTo(lon, canvas.height);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Radial-gradient sprite for a marker glow — procedural, no image asset. */
function buildGlowSprite(hex: number): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const c = new THREE.Color(hex);
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, `rgba(${c.r * 255},${c.g * 255},${c.b * 255},0.9)`);
  grad.addColorStop(0.4, `rgba(${c.r * 255},${c.g * 255},${c.b * 255},0.35)`);
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

function detectWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext("webgl2") || canvas.getContext("webgl"))
    );
  } catch {
    return false;
  }
}

/** Linear interpolation between two Vec3 points. */
function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

/** Samples a point along an (open) polyline of scene-unit points at frac [0,1]. */
function sampleScenePath(points: Vec3[], frac: number): Vec3 {
  if (points.length === 0) return { x: 0, y: 0, z: 0 };
  if (points.length === 1) return points[0];
  const f = Math.min(0.999999, Math.max(0, frac)) * (points.length - 1);
  const i0 = Math.floor(f);
  const i1 = Math.min(points.length - 1, i0 + 1);
  return lerpVec3(points[i0], points[i1], f - i0);
}

/** Triangle wave in [0,1] — used to ping-pong a marker across a short,
 * non-looping trajectory window instead of teleporting back to the start. */
function pingPong(x: number): number {
  const m = ((x % 2) + 2) % 2;
  return m < 1 ? m : 2 - m;
}

export default function Globe3D({
  mode = "synthetic",
  primaryElements,
  secondaryElements,
  primaryTrajectory,
  secondaryTrajectory,
  secondaryColor,
  onUnavailable,
}: {
  /** "synthetic" (default): illustrative Keplerian orbit from OrbitalElements3D.
   *  "trajectory": real SGP4-propagated position arrays from the backend. */
  mode?: "synthetic" | "trajectory";
  primaryElements?: OrbitalElements3D;
  secondaryElements?: OrbitalElements3D;
  primaryTrajectory?: Vec3[];
  secondaryTrajectory?: Vec3[];
  secondaryColor: string;
  onUnavailable?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [supported, setSupported] = useState<boolean | null>(null);

  // Runtime guard: trajectory mode requires both arrays with data. If either
  // is missing, this component would otherwise render an empty globe with
  // no explanation — fail with a clear message instead, same defensive
  // posture as the WebGL check below.
  const trajectoryDataMissing =
    mode === "trajectory" &&
    (!primaryTrajectory || !secondaryTrajectory || primaryTrajectory.length === 0 || secondaryTrajectory.length === 0);

  useEffect(() => {
    // Intentional: WebGL support can only be detected client-side, post-mount.
    if (!detectWebGL()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSupported(false);
      onUnavailable?.();
      return;
    }
    setSupported(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (supported !== true) return;
    if (trajectoryDataMissing) return;
    const containerEl = containerRef.current;
    if (!containerEl) return;
    const container: HTMLDivElement = containerEl;

    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Resolve the current theme straight from :root — the only place
    // color is authored is app/globals.css; this never hardcodes a value.
    const theme = getGlobeTheme();

    // --- scene setup ---
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 1.1, 3.1);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      // Intentional: renderer construction failing is a runtime capability
      // check, only knowable after attempting it.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSupported(false);
      onUnavailable?.();
      return;
    }
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 1.6;
    controls.maxDistance = 6;
    controls.enablePan = false;
    controls.autoRotate = !prefersReduced;
    controls.autoRotateSpeed = 0.35;

    // --- earth ---
    const earthTexture = buildEarthTexture();
    const earthGeo = new THREE.SphereGeometry(1, 64, 64);
    const earthMat = new THREE.MeshStandardMaterial({
      map: earthTexture,
      roughness: 0.85,
      metalness: 0.05,
      emissive: new THREE.Color(theme.bg),
      emissiveIntensity: 0.15,
    });
    const earth = new THREE.Mesh(earthGeo, earthMat);
    scene.add(earth);

    // atmosphere rim glow
    const atmoGeo = new THREE.SphereGeometry(1.035, 48, 48);
    const atmoMat = new THREE.MeshBasicMaterial({
      color: theme.accent,
      transparent: true,
      opacity: 0.06,
      side: THREE.BackSide,
    });
    const atmo = new THREE.Mesh(atmoGeo, atmoMat);
    scene.add(atmo);

    // lighting
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(4, 2, 3);
    scene.add(sun);
    scene.add(new THREE.AmbientLight(0x3a3a3f, 1.1));

    // starfield
    {
      const starCount = 500;
      const positions = new Float32Array(starCount * 3);
      let s = 91;
      const rand = () => {
        s = (s * 16807) % 2147483647;
        return s / 2147483647;
      };
      for (let i = 0; i < starCount; i++) {
        const r = 14 + rand() * 10;
        const theta = rand() * Math.PI * 2;
        const phi = Math.acos(2 * rand() - 1);
        positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        positions[i * 3 + 2] = r * Math.cos(phi);
      }
      const starGeo = new THREE.BufferGeometry();
      starGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const starMat = new THREE.PointsMaterial({ color: theme.textSecondary, size: 0.02, sizeAttenuation: true });
      scene.add(new THREE.Points(starGeo, starMat));
    }

    const isTrajectory = mode === "trajectory";

    // --- resolve scene-unit point arrays for both bodies, once, up front ---
    // Synthetic mode computes a full closed-ring orbit from Keplerian
    // elements (unchanged math from before). Trajectory mode uses the real
    // propagated points handed in as props, converted to scene units.
    const primaryScenePoints: Vec3[] = isTrajectory
      ? (primaryTrajectory as Vec3[]).map((p) => toSceneUnits(p))
      : orbitPath(primaryElements as OrbitalElements3D, 160).map((p) => toSceneUnits(p));
    const secondaryScenePoints: Vec3[] = isTrajectory
      ? (secondaryTrajectory as Vec3[]).map((p) => toSceneUnits(p))
      : orbitPath(secondaryElements as OrbitalElements3D, 160).map((p) => toSceneUnits(p));

    // --- orbit paths ---
    function buildPathLine(scenePoints: Vec3[], hex: number, dashed: boolean, closed: boolean) {
      const pts = scenePoints.map((s) => new THREE.Vector3(s.x, s.z, s.y)); // map to three's Y-up
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = dashed
        ? new THREE.LineDashedMaterial({ color: hex, dashSize: 0.04, gapSize: 0.025, transparent: true, opacity: 0.8 })
        : new THREE.LineBasicMaterial({ color: hex, transparent: true, opacity: 0.8 });
      const line = closed ? new THREE.LineLoop(geo, mat) : new THREE.Line(geo, mat);
      if (dashed) line.computeLineDistances();
      scene.add(line);
      return line;
    }
    // Synthetic orbits are drawn as a closed ring (LineLoop); a real
    // trajectory is a short open arc around TCA, drawn as an open polyline.
    buildPathLine(primaryScenePoints, theme.accent, false, !isTrajectory);
    const secHex = severityHexFromVar(secondaryColor, theme);
    buildPathLine(secondaryScenePoints, secHex, true, !isTrajectory);

    // --- moving markers ---
    function buildMarker(hex: number) {
      const group = new THREE.Group();
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(0.02, 16, 16),
        new THREE.MeshBasicMaterial({ color: hex })
      );
      group.add(core);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: buildGlowSprite(hex), transparent: true, depthWrite: false }));
      glow.scale.set(0.16, 0.16, 1);
      group.add(glow);
      scene.add(group);
      return group;
    }
    const primaryMarker = buildMarker(theme.accent);
    const secondaryMarker = buildMarker(secHex);

    // closing line between the two current positions
    const closingGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const closingMat = new THREE.LineDashedMaterial({ color: theme.textPrimary, dashSize: 0.03, gapSize: 0.02, transparent: true, opacity: 0.5 });
    const closingLine = new THREE.Line(closingGeo, closingMat);
    scene.add(closingLine);

    // Synthetic marker placement: unchanged from before, samples the
    // Keplerian generator directly by orbital fraction.
    function placeMarkerSynthetic(marker: THREE.Group, elements: OrbitalElements3D, frac: number) {
      const p = toSceneUnits(positionAtFraction(elements, frac));
      marker.position.set(p.x, p.z, p.y);
      return marker.position;
    }
    // Trajectory marker placement: samples the fetched point array.
    function placeMarkerFromPath(marker: THREE.Group, scenePoints: Vec3[], frac: number) {
      const p = sampleScenePath(scenePoints, frac);
      marker.position.set(p.x, p.z, p.y);
      return marker.position;
    }

    // --- responsive sizing ---
    function resize() {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(w, h, false);
    }
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    // --- animation loop ---
    let raf = 0;
    let t = 0;
    const speed = prefersReduced ? 0 : 0.00012;
    function animate() {
      raf = requestAnimationFrame(animate);
      t += speed;

      let p1: THREE.Vector3;
      let p2: THREE.Vector3;
      if (isTrajectory) {
        // Ping-pong across the fetched window so the marker sweeps back and
        // forth through the real approach-and-recede around TCA, rather
        // than wrapping/teleporting like a full closed orbit would.
        const frac = pingPong(t * 3);
        p1 = placeMarkerFromPath(primaryMarker, primaryScenePoints, frac);
        p2 = placeMarkerFromPath(secondaryMarker, secondaryScenePoints, frac);
      } else {
        const el1 = primaryElements as OrbitalElements3D;
        const el2 = secondaryElements as OrbitalElements3D;
        p1 = placeMarkerSynthetic(primaryMarker, el1, t % 1);
        p2 = placeMarkerSynthetic(secondaryMarker, el2, (t * (el2.period_minutes / el1.period_minutes)) % 1);
      }

      const posAttr = closingGeo.attributes.position as THREE.BufferAttribute;
      posAttr.setXYZ(0, p1.x, p1.y, p1.z);
      posAttr.setXYZ(1, p2.x, p2.y, p2.z);
      posAttr.needsUpdate = true;
      closingLine.computeLineDistances();
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    // --- cleanup: dispose everything, no leaks between event selections ---
    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      controls.dispose();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.Points) {
          obj.geometry?.dispose();
          const mat = obj.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat?.dispose();
        }
        if (obj instanceof THREE.Sprite) {
          obj.material.map?.dispose();
          obj.material.dispose();
        }
      });
      earthTexture.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [
    mode,
    primaryElements,
    secondaryElements,
    primaryTrajectory,
    secondaryTrajectory,
    trajectoryDataMissing,
    secondaryColor,
    supported,
    onUnavailable,
  ]);

  if (supported === false) {
    return (
      <div
        className="flex items-center justify-center h-full text-center px-6 py-10"
        style={{ color: "var(--text-tertiary)" }}
      >
        <p className="font-mono text-xs">
          3D rendering isn&apos;t available on this device. Showing the 2D view instead.
        </p>
      </div>
    );
  }

  if (trajectoryDataMissing) {
    return (
      <div
        className="flex items-center justify-center h-full text-center px-6 py-10"
        style={{ color: "var(--text-tertiary)" }}
      >
        <p className="font-mono text-xs">
          Real trajectory data isn&apos;t available for this pair.
        </p>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full min-h-[240px]" ref={containerRef}>
      {supported === null && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-mono text-[11px]" style={{ color: "var(--text-tertiary)" }}>
            initializing scene…
          </span>
        </div>
      )}
    </div>
  );
}
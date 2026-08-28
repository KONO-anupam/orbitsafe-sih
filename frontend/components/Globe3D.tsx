"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { OrbitalElements3D } from "@/lib/types";
import { orbitPath, positionAtFraction, toSceneUnits } from "@/lib/orbitGeometry";
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

export default function Globe3D({
  primaryElements,
  secondaryElements,
  secondaryColor,
  onUnavailable,
}: {
  primaryElements: OrbitalElements3D;
  secondaryElements: OrbitalElements3D;
  secondaryColor: string;
  onUnavailable?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [supported, setSupported] = useState<boolean | null>(null);

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

    // --- orbit paths ---
    function buildPathLine(elements: OrbitalElements3D, hex: number, dashed: boolean) {
      const pts = orbitPath(elements, 160).map((p) => {
        const s = toSceneUnits(p);
        return new THREE.Vector3(s.x, s.z, s.y); // map to three's Y-up
      });
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = dashed
        ? new THREE.LineDashedMaterial({ color: hex, dashSize: 0.04, gapSize: 0.025, transparent: true, opacity: 0.8 })
        : new THREE.LineBasicMaterial({ color: hex, transparent: true, opacity: 0.8 });
      const line = new THREE.LineLoop(geo, mat);
      if (dashed) line.computeLineDistances();
      scene.add(line);
      return line;
    }
    buildPathLine(primaryElements, theme.accent, false);
    const secHex = severityHexFromVar(secondaryColor, theme);
    buildPathLine(secondaryElements, secHex, true);

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

    function placeMarker(marker: THREE.Group, elements: OrbitalElements3D, frac: number) {
      const p = toSceneUnits(positionAtFraction(elements, frac));
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
      const p1 = placeMarker(primaryMarker, primaryElements, t % 1);
      const p2 = placeMarker(secondaryMarker, secondaryElements, (t * (secondaryElements.period_minutes / primaryElements.period_minutes)) % 1);
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
  }, [primaryElements, secondaryElements, secondaryColor, supported, onUnavailable]);

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
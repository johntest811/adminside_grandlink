"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { FBXLoader, GLTFLoader, OrbitControls } from "three-stdlib";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";

function getUrlExtension(url: string): string {
  const clean = (url || "").split("?")[0].split("#")[0];
  const lastDot = clean.lastIndexOf(".");
  if (lastDot === -1) return "";
  return clean.slice(lastDot + 1).toLowerCase();
}

type WeatherKey = "sunny" | "rainy" | "night" | "foggy";

type ModelUnits = "mm" | "cm" | "m";

export type ThreeDModelViewerProps = {
  modelUrls: string[];
  initialIndex?: number;
  weather: WeatherKey;
  skyboxes?: Partial<Record<WeatherKey, string | null>> | null;
  productDimensions?: {
    width?: number | string | null;
    height?: number | string | null;
    thickness?: number | string | null;
    units?: ModelUnits | null;
  };
  width?: number;
  height?: number;
};

function mmPerUnit(units: ModelUnits): number {
  switch (units) {
    case "mm":
      return 1;
    case "cm":
      return 10;
    case "m":
      return 1000;
  }
}

function formatLength(valueMm: number, displayUnits: ModelUnits): string {
  if (!Number.isFinite(valueMm)) return "—";
  const divisor = mmPerUnit(displayUnits);
  const value = valueMm / divisor;

  let rounded: number;
  if (displayUnits === "mm") {
    const abs = Math.abs(value);
    rounded = abs >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  } else if (displayUnits === "cm") {
    rounded = Math.round(value * 10) / 10;
  } else {
    rounded = Math.round(value * 100) / 100;
  }

  return `${rounded.toLocaleString()} ${displayUnits}`;
}

function parseDimensionToMm(value: unknown, defaultUnits: ModelUnits): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value * mmPerUnit(defaultUnits) : null;

  const raw = String(value).trim();
  if (!raw) return null;

  const m = raw.match(/^(-?\d+(?:\.\d+)?)(?:\s*(mm|cm|m))?$/i);
  if (!m) return null;

  const num = Number.parseFloat(m[1]);
  if (!Number.isFinite(num)) return null;

  const units = (m[2]?.toLowerCase() as ModelUnits | undefined) ?? defaultUnits;
  return num * mmPerUnit(units);
}

export default function ThreeDModelViewer({
  modelUrls,
  initialIndex,
  weather,
  skyboxes,
  productDimensions,
  width = 1200,
  height = 700,
}: ThreeDModelViewerProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [currentFbxIndex, setCurrentFbxIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [showMeasurements, setShowMeasurements] = useState(true);
  const [modelUnits, setModelUnits] = useState<ModelUnits>("mm");
  const [dimsMm, setDimsMm] = useState<{ width: number; height: number; thickness: number } | null>(null);

  const labelElsRef = useRef<{ w?: HTMLDivElement; h?: HTMLDivElement; t?: HTMLDivElement }>({});
  const originalSizeRef = useRef<THREE.Vector3 | null>(null);
  const showMeasurementsRef = useRef<boolean>(true);
  const modelUnitsRef = useRef<ModelUnits>("mm");
  const assumedModelUnitsRef = useRef<ModelUnits>("m");

  const weatherRef = useRef<WeatherKey>(weather);
  const skyboxesRef = useRef<ThreeDModelViewerProps["skyboxes"]>(skyboxes ?? null);
  const applyWeatherRef = useRef<((type: WeatherKey) => void) | null>(null);

  const validUrls = useMemo(
    () => (Array.isArray(modelUrls) ? modelUrls.filter((u) => typeof u === "string" && u.trim()) : []),
    [modelUrls]
  );

  useEffect(() => {
    if (!Number.isFinite(initialIndex as any)) return;
    if (!validUrls.length) return;
    const clamped = Math.max(0, Math.min(validUrls.length - 1, Number(initialIndex) || 0));
    setCurrentFbxIndex(clamped);
  }, [initialIndex, validUrls.length]);

  const currentUrl = validUrls[currentFbxIndex] || validUrls[0] || "";

  const productDimsMm = useMemo(() => {
    const defaultUnits = (productDimensions?.units ?? "mm") as ModelUnits;
    const w = parseDimensionToMm(productDimensions?.width, defaultUnits);
    const h = parseDimensionToMm(productDimensions?.height, defaultUnits);
    const t = parseDimensionToMm(productDimensions?.thickness, defaultUnits);
    if (w === null || h === null || t === null) return null;
    return { width: w, height: h, thickness: t };
  }, [productDimensions?.width, productDimensions?.height, productDimensions?.thickness, productDimensions?.units]);

  const usesProductDimensions = !!productDimsMm;

  useEffect(() => {
    showMeasurementsRef.current = showMeasurements;
  }, [showMeasurements]);

  useEffect(() => {
    modelUnitsRef.current = modelUnits;

    if (usesProductDimensions && productDimsMm) {
      setDimsMm(productDimsMm);
    }

    const s = originalSizeRef.current;
    if (s && labelElsRef.current) {
      const mpuNow = mmPerUnit(assumedModelUnitsRef.current);
      const computedMm = {
        width: s.x * mpuNow,
        height: s.y * mpuNow,
        thickness: s.z * mpuNow,
      };
      const displayMm = productDimsMm ?? computedMm;
      setDimsMm(displayMm);

      try {
        if (labelElsRef.current.w) labelElsRef.current.w.textContent = formatLength(displayMm.width, modelUnits);
        if (labelElsRef.current.h) labelElsRef.current.h.textContent = formatLength(displayMm.height, modelUnits);
        if (labelElsRef.current.t) labelElsRef.current.t.textContent = formatLength(displayMm.thickness, modelUnits);
      } catch {}
    }
  }, [modelUnits, usesProductDimensions, productDimsMm]);

  useEffect(() => {
    weatherRef.current = weather;
    applyWeatherRef.current?.(weather);
  }, [weather]);

  useEffect(() => {
    skyboxesRef.current = skyboxes ?? null;
    applyWeatherRef.current?.(weatherRef.current);
  }, [skyboxes]);

  const storageKey = useMemo(() => (currentUrl ? `gl:fbxUnits:${currentUrl}` : ""), [currentUrl]);

  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      const u = raw === "mm" || raw === "cm" || raw === "m" ? (raw as ModelUnits) : null;
      if (u) assumedModelUnitsRef.current = u;
    } catch {}
  }, [storageKey]);

  useEffect(() => {
    if (!mountRef.current || !currentUrl) return;

    setLoading(true);

    try {
      const anyTHREE: any = THREE;
      if (anyTHREE.ColorManagement && "enabled" in anyTHREE.ColorManagement) {
        anyTHREE.ColorManagement.enabled = true;
      }
    } catch {}

    const hwConcurrency = (navigator as any).hardwareConcurrency || 4;
    const deviceDpr = window.devicePixelRatio || 1;

    const dprForPerf = Math.min(deviceDpr, 1.5);
    const performanceFactor = Math.min(1, hwConcurrency / 4) * (1 / dprForPerf);
    const isLowEnd = hwConcurrency < 4 || performanceFactor < 0.5;
    const detailLevel = isLowEnd ? 0.5 : performanceFactor > 0.8 ? 1.0 : 0.75;

    const dpr = Math.min(deviceDpr, isLowEnd ? 1.25 : 2);

    const BASE_RAIN = Math.round(8000 * performanceFactor);
    const STORM_RAIN = Math.round(22000 * performanceFactor);

    const container = mountRef.current;
    const renderWidth = Math.floor(container.clientWidth || width);
    const renderHeight = Math.floor(container.clientHeight || height);

    while (container.firstChild) container.removeChild(container.firstChild);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);

    const camera = new THREE.PerspectiveCamera(50, renderWidth / renderHeight, 0.1, 2000);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isLowEnd,
      alpha: false,
      powerPreference: isLowEnd ? "low-power" : "high-performance",
      logarithmicDepthBuffer: !isLowEnd,
      preserveDrawingBuffer: false,
      premultipliedAlpha: false,
    });
    renderer.setSize(renderWidth, renderHeight);
    renderer.setPixelRatio(dpr);

    renderer.shadowMap.enabled = true;
    if (!isLowEnd) {
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    } else {
      renderer.shadowMap.type = THREE.BasicShadowMap;
    }

    try {
      const anyTHREE: any = THREE;
      if ("outputColorSpace" in renderer && anyTHREE.SRGBColorSpace !== undefined) {
        (renderer as any).outputColorSpace = anyTHREE.SRGBColorSpace;
      } else if ("outputEncoding" in renderer && anyTHREE.sRGBEncoding !== undefined) {
        (renderer as any).outputEncoding = anyTHREE.sRGBEncoding;
      }
    } catch {}
    if ("physicallyCorrectLights" in renderer) (renderer as any).physicallyCorrectLights = true;

    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    container.appendChild(renderer.domElement);

    let labelRenderer: CSS2DRenderer | null = null;
    try {
      labelRenderer = new CSS2DRenderer();
      labelRenderer.setSize(renderWidth, renderHeight);
      labelRenderer.domElement.style.position = "absolute";
      labelRenderer.domElement.style.top = "0px";
      labelRenderer.domElement.style.left = "0px";
      labelRenderer.domElement.style.pointerEvents = "none";
      container.appendChild(labelRenderer.domElement);
    } catch {
      labelRenderer = null;
    }

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(0, 0, 0);
    controls.enableZoom = true;
    controls.enablePan = true;
    controls.enableRotate = true;

    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambient);

    const sunLight = new THREE.DirectionalLight(0xfff1c0, 2.0);
    sunLight.position.set(100, 150, 50);
    sunLight.castShadow = true;

    const shadowMapSize = isLowEnd ? 1024 : detailLevel > 0.75 ? 4096 : 2048;
    sunLight.shadow.mapSize.width = shadowMapSize;
    sunLight.shadow.mapSize.height = shadowMapSize;
    sunLight.shadow.camera.near = 0.1;
    sunLight.shadow.camera.far = 1000;
    sunLight.shadow.camera.left = -200;
    sunLight.shadow.camera.right = 200;
    sunLight.shadow.camera.top = 200;
    sunLight.shadow.camera.bottom = -200;
    sunLight.shadow.bias = -0.0001;
    sunLight.shadow.normalBias = 0.02;
    sunLight.shadow.radius = isLowEnd ? 2 : 8;
    scene.add(sunLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.6);
    fillLight.position.set(-80, 100, 80);
    fillLight.castShadow = !isLowEnd;
    if (!isLowEnd) {
      fillLight.shadow.mapSize.width = 1024;
      fillLight.shadow.mapSize.height = 1024;
      fillLight.shadow.camera.near = 0.1;
      fillLight.shadow.camera.far = 500;
      fillLight.shadow.camera.left = -100;
      fillLight.shadow.camera.right = 100;
      fillLight.shadow.camera.top = 100;
      fillLight.shadow.camera.bottom = -100;
      fillLight.shadow.bias = -0.0002;
      fillLight.shadow.normalBias = 0.015;
      fillLight.shadow.radius = 4;
    }
    scene.add(fillLight);

    if (!isLowEnd) {
      const rimLight1 = new THREE.DirectionalLight(0xccddff, 0.8);
      rimLight1.position.set(0, 50, -150);
      scene.add(rimLight1);

      const rimLight2 = new THREE.DirectionalLight(0xffeecc, 0.6);
      rimLight2.position.set(150, 80, 0);
      scene.add(rimLight2);
    }

    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    hemi.position.set(0, 200, 0);
    scene.add(hemi);

    scene.environment = null;

    let skyboxTex: THREE.Texture | null = null;
    let activeSkyboxUrl: string | null = null;

    const setTexColorSpace = (tex: any) => {
      const anyTHREE: any = THREE;
      if (!tex) return;
      if ("colorSpace" in tex && anyTHREE.SRGBColorSpace !== undefined) {
        tex.colorSpace = anyTHREE.SRGBColorSpace;
      } else if ("encoding" in tex && anyTHREE.sRGBEncoding !== undefined) {
        tex.encoding = anyTHREE.sRGBEncoding;
      }
    };

    let rainSystem: THREE.LineSegments | null = null;
    let rainVelY: Float32Array | null = null;
    let rainVelX: Float32Array | null = null;
    let rainLen: Float32Array | null = null;
    let rainSwirlPhase: Float32Array | null = null;
    let rainSwirlRadius: Float32Array | null = null;
    let rainBaseX: Float32Array | null = null;
    let rainBaseZ: Float32Array | null = null;
    let rainArea:
      | {
          minX: number;
          maxX: number;
          minY: number;
          maxY: number;
          minZ: number;
          maxZ: number;
        }
      | null = null;

    let modelBounds: THREE.Box3 | null = null;
    let measurementGroup: THREE.Group | null = null;

    const disposeMeasurementGroup = () => {
      if (!measurementGroup) return;
      try {
        measurementGroup.traverse((obj: any) => {
          if (obj.geometry) {
            try {
              obj.geometry.dispose();
            } catch {}
          }
          if (obj.material) {
            if (Array.isArray(obj.material)) {
              obj.material.forEach((m: any) => {
                try {
                  m.dispose();
                } catch {}
              });
            } else {
              try {
                obj.material.dispose();
              } catch {}
            }
          }
        });
      } catch {}
      try {
        scene.remove(measurementGroup);
      } catch {}
      measurementGroup = null;
    };

    const makeLabel = (initialText: string, kind: "w" | "h" | "t") => {
      const el = document.createElement("div");
      el.textContent = initialText;
      el.style.padding = "6px 10px";
      el.style.borderRadius = "999px";
      el.style.background = "rgba(15, 23, 42, 0.78)";
      el.style.color = "white";
      el.style.fontSize = "12px";
      el.style.fontWeight = "600";
      el.style.letterSpacing = "0.2px";
      el.style.whiteSpace = "nowrap";
      el.style.boxShadow = "0 6px 18px rgba(0,0,0,0.25)";
      el.style.backdropFilter = "blur(6px)";
      labelElsRef.current[kind] = el;
      return new CSS2DObject(el);
    };

    const addDimension = (opts: {
      start: THREE.Vector3;
      end: THREE.Vector3;
      extAStart?: THREE.Vector3;
      extAEnd?: THREE.Vector3;
      extBStart?: THREE.Vector3;
      extBEnd?: THREE.Vector3;
      tickDir: THREE.Vector3;
      label: CSS2DObject;
      color?: number;
    }) => {
      const color = opts.color ?? 0x1e88e5;
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
      });
      const group = new THREE.Group();

      const mkLine = (a: THREE.Vector3, b: THREE.Vector3) => {
        const dir = b.clone().sub(a);
        const len = dir.length();
        if (!Number.isFinite(len) || len <= 1e-6) return;

        const radius = THREE.MathUtils.clamp(len * 0.01, 0.06, 0.28);
        const geom = new THREE.CylinderGeometry(radius, radius, len, 10, 1, true);
        const mesh = new THREE.Mesh(geom, mat);

        const mid = a.clone().add(b).multiplyScalar(0.5);
        mesh.position.copy(mid);
        const axis = new THREE.Vector3(0, 1, 0);
        const quat = new THREE.Quaternion().setFromUnitVectors(axis, dir.clone().normalize());
        mesh.quaternion.copy(quat);

        mesh.renderOrder = 3;
        group.add(mesh);
      };

      mkLine(opts.start, opts.end);
      if (opts.extAStart && opts.extAEnd) mkLine(opts.extAStart, opts.extAEnd);
      if (opts.extBStart && opts.extBEnd) mkLine(opts.extBStart, opts.extBEnd);

      const tickLen = opts.start.distanceTo(opts.end) * 0.03;
      const tick = opts.tickDir.clone().normalize().multiplyScalar(Math.max(1.5, tickLen));
      mkLine(opts.start.clone().add(tick), opts.start.clone().sub(tick));
      mkLine(opts.end.clone().add(tick), opts.end.clone().sub(tick));

      const mid = opts.start.clone().add(opts.end).multiplyScalar(0.5);
      opts.label.position.copy(mid);
      group.add(opts.label);

      return group;
    };

    let frameCounter = 0;
    let lastFrameMs = performance.now();

    const computeRainArea = () => {
      if (modelBounds) {
        const center = modelBounds.getCenter(new THREE.Vector3());
        const size = modelBounds.getSize(new THREE.Vector3());
        const spanX = Math.max(size.x * 2.4, 120);
        const spanZ = Math.max(size.z * 2.4, 120);
        const height = Math.max(size.y * 2.6, 200);
        const padY = Math.max(size.y * 0.6, 40);

        return {
          minX: center.x - spanX * 0.5,
          maxX: center.x + spanX * 0.5,
          minY: center.y - padY,
          maxY: center.y + height * 0.5,
          minZ: center.z - spanZ * 0.5,
          maxZ: center.z + spanZ * 0.5,
        };
      }

      return {
        minX: -110,
        maxX: 110,
        minY: -40,
        maxY: 170,
        minZ: -110,
        maxZ: 110,
      };
    };

    const applyWeather = (type: WeatherKey) => {
      if (rainSystem) {
        try {
          scene.remove(rainSystem);
          rainSystem.geometry.dispose();
          (rainSystem.material as THREE.LineBasicMaterial).dispose();
        } catch {}
        rainSystem = null;
        rainVelY = null;
        rainVelX = null;
        rainLen = null;
        rainSwirlPhase = null;
        rainSwirlRadius = null;
        rainBaseX = null;
        rainBaseZ = null;
        rainArea = null;
      }
      scene.fog = null;

      activeSkyboxUrl = null;
      if (skyboxTex) {
        try {
          skyboxTex.dispose();
        } catch {}
        skyboxTex = null;
      }

      scene.environment = null;

      const sb = skyboxesRef.current;
      const skyUrlRaw = sb && typeof sb === "object" ? (sb as any)[type] : null;
      const skyUrl = typeof skyUrlRaw === "string" ? skyUrlRaw.trim() : "";
      if (skyUrl) {
        activeSkyboxUrl = skyUrl;
        const loader = new THREE.TextureLoader();
        loader.setCrossOrigin("anonymous");
        loader.load(
          skyUrl,
          (tex) => {
            if (activeSkyboxUrl !== skyUrl) {
              try {
                tex.dispose();
              } catch {}
              return;
            }
            skyboxTex = tex;
            setTexColorSpace(skyboxTex);
            try {
              skyboxTex.minFilter = THREE.LinearMipmapLinearFilter;
              skyboxTex.magFilter = THREE.LinearFilter;
              skyboxTex.generateMipmaps = true;
              const maxAniso = Math.max(1, Math.min(16, renderer.capabilities.getMaxAnisotropy()));
              (skyboxTex as any).anisotropy = maxAniso;
              skyboxTex.needsUpdate = true;
            } catch {}

            skyboxTex.mapping = THREE.EquirectangularReflectionMapping;
            scene.background = skyboxTex;

            try {
              const extras = scene as unknown as Record<string, unknown>;
              if ("backgroundBlurriness" in extras) {
                (scene as unknown as { backgroundBlurriness: number }).backgroundBlurriness = 0.0;
              }
              if ("backgroundIntensity" in extras) {
                (scene as unknown as { backgroundIntensity: number }).backgroundIntensity = 1.0;
              }
            } catch {}
          },
          undefined,
          () => {
            if (activeSkyboxUrl === skyUrl) activeSkyboxUrl = null;
          }
        );
      }

      if (type === "sunny") {
        scene.background = new THREE.Color(0x87ceeb);
        ambient.intensity = 0.45;
        hemi.intensity = 0.6;
        fillLight.intensity = 0.6;
        try {
          sunLight.color.set(0xfff1c0);
        } catch {}
        sunLight.visible = true;
        sunLight.intensity = 2.2;
        renderer.setClearColor(0x87ceeb, 1);
      } else if (type === "rainy") {
        scene.background = new THREE.Color(0xbfd1e5);
        ambient.intensity = 0.3;
        hemi.intensity = 0.5;
        fillLight.intensity = 0.55;
        try {
          sunLight.color.set(0xfff1c0);
        } catch {}
        sunLight.visible = true;
        sunLight.intensity = 0.8;
        renderer.setClearColor(0xbfd1e5, 1);

        const rainDensity = isLowEnd ? 0.1 : 0.16;
        const rainCount = Math.max(250, Math.round((performanceFactor > 0.6 ? STORM_RAIN : BASE_RAIN) * rainDensity));
        rainArea = computeRainArea();

        const positions = new Float32Array(rainCount * 2 * 3);
        rainVelY = new Float32Array(rainCount);
        rainVelX = new Float32Array(rainCount);
        rainLen = new Float32Array(rainCount);
        rainSwirlPhase = new Float32Array(rainCount);
        rainSwirlRadius = new Float32Array(rainCount);
        rainBaseX = new Float32Array(rainCount);
        rainBaseZ = new Float32Array(rainCount);

        const spawnOne = (i: number) => {
          if (!rainArea) return;
          const headX = rainArea.minX + Math.random() * (rainArea.maxX - rainArea.minX);
          const headY = rainArea.minY + Math.random() * (rainArea.maxY - rainArea.minY);
          const headZ = rainArea.minZ + Math.random() * (rainArea.maxZ - rainArea.minZ);
          rainBaseX![i] = headX;
          rainBaseZ![i] = headZ;

          const baseLen = 7 + Math.random() * 12;
          const len = baseLen * (0.85 + Math.min(1, performanceFactor) * 0.25);
          rainLen![i] = len;

          rainVelY![i] = (44 + Math.random() * 34) * (1 + (0.75 - performanceFactor) * 0.2);
          rainVelX![i] = (Math.random() - 0.5) * (6 + Math.random() * 10);
          rainSwirlPhase![i] = Math.random() * Math.PI * 2;
          rainSwirlRadius![i] = 0.35 + Math.random() * 1.8;

          const idx = i * 6;
          positions[idx + 0] = headX;
          positions[idx + 1] = headY;
          positions[idx + 2] = headZ;
          positions[idx + 3] = headX - rainVelX![i] * 0.015 * len;
          positions[idx + 4] = headY - len;
          positions[idx + 5] = headZ - 0.01 * len;
        };

        for (let i = 0; i < rainCount; i++) spawnOne(i);

        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));

        const mat = new THREE.LineBasicMaterial({
          color: 0x6bb6ff,
          transparent: true,
          opacity: 0.32,
          depthWrite: false,
          blending: THREE.NormalBlending,
        });

        rainSystem = new THREE.LineSegments(geo, mat);
        rainSystem.frustumCulled = false;
        rainSystem.renderOrder = 1;
        scene.add(rainSystem);

        const fogDensity = performanceFactor > 0.5 ? 0.001 : 0.0006;
        scene.fog = new THREE.FogExp2(0xbfd1e5, fogDensity);
      } else if (type === "night") {
        scene.background = new THREE.Color(0x0b1020);
        renderer.setClearColor(0x0b1020, 1);
        ambient.intensity = 0.32;
        hemi.intensity = 0.35;
        fillLight.intensity = 0.75;
        try {
          sunLight.color.set(0xbdd1ff);
        } catch {}
        sunLight.visible = true;
        sunLight.intensity = 1.15;
        scene.fog = new THREE.FogExp2(0x0b1020, 0.0006);
      } else if (type === "foggy") {
        scene.background = new THREE.Color(0xd6dbe0);
        ambient.intensity = 0.6;
        hemi.intensity = 0.65;
        fillLight.intensity = 0.6;
        try {
          sunLight.color.set(0xfff1c0);
        } catch {}
        sunLight.visible = true;
        sunLight.intensity = 0.8;
        scene.fog = new THREE.FogExp2(0xd6dbe0, 0.002);
        renderer.setClearColor(0xd6dbe0, 1);
      }
    };

    applyWeatherRef.current = (t) => applyWeather(t);
    applyWeather(weatherRef.current);

    const modelExt = getUrlExtension(currentUrl);

    const handleLoaded = (object: THREE.Object3D) => {
      object.traverse((child: any) => {
        if (!child.isMesh) return;
        child.castShadow = true;
        child.receiveShadow = true;
        try {
          const tweakMat = (mat: any) => {
            if (!mat) return;
            try {
              if (mat.map) setTexColorSpace(mat.map);
            } catch {}
            try {
              if (mat.emissiveMap) setTexColorSpace(mat.emissiveMap);
            } catch {}
            try {
              mat.side = THREE.DoubleSide;
            } catch {}
            mat.needsUpdate = true;
          };
          if (Array.isArray(child.material)) child.material.forEach(tweakMat);
          else tweakMat(child.material);
        } catch {}
      });

      const rawBox = new THREE.Box3().setFromObject(object);
      const rawSize = rawBox.getSize(new THREE.Vector3());
      const rawCenter = rawBox.getCenter(new THREE.Vector3());

      originalSizeRef.current = rawSize.clone();
      const mpuNow = mmPerUnit(assumedModelUnitsRef.current);
      const computedMm = {
        width: rawSize.x * mpuNow,
        height: rawSize.y * mpuNow,
        thickness: rawSize.z * mpuNow,
      };
      const displayMm = productDimsMm ?? computedMm;
      setDimsMm(displayMm);

      const modelGroup = new THREE.Group();
      object.position.set(-rawCenter.x, -rawBox.min.y, -rawCenter.z);
      modelGroup.add(object);

      const maxDimension = Math.max(rawSize.x, rawSize.y, rawSize.z);
      if (maxDimension > 0) {
        const targetSize = 100;
        const scale = targetSize / maxDimension;
        modelGroup.scale.setScalar(scale);
      }

      modelGroup.position.set(0, 0, 0);
      scene.add(modelGroup);

      modelBounds = new THREE.Box3().setFromObject(modelGroup);

      disposeMeasurementGroup();
      labelElsRef.current = {};
      if (modelBounds) {
        const bounds = modelBounds.clone();
        const bSize = bounds.getSize(new THREE.Vector3());
        const maxS = Math.max(bSize.x, bSize.y, bSize.z);
        const offset = Math.max(maxS * 0.08, 3);

        measurementGroup = new THREE.Group();
        measurementGroup.renderOrder = 3;

        const min = bounds.min;
        const max = bounds.max;

        const wStart = new THREE.Vector3(min.x, min.y, max.z + offset);
        const wEnd = new THREE.Vector3(max.x, min.y, max.z + offset);
        const wExtAStart = new THREE.Vector3(min.x, min.y, max.z);
        const wExtAEnd = wStart.clone();
        const wExtBStart = new THREE.Vector3(max.x, min.y, max.z);
        const wExtBEnd = wEnd.clone();
        const wLabel = makeLabel(formatLength(displayMm.width, modelUnitsRef.current), "w");
        measurementGroup.add(
          addDimension({
            start: wStart,
            end: wEnd,
            extAStart: wExtAStart,
            extAEnd: wExtAEnd,
            extBStart: wExtBStart,
            extBEnd: wExtBEnd,
            tickDir: new THREE.Vector3(0, 1, 0),
            label: wLabel,
          })
        );

        const hStart = new THREE.Vector3(max.x + offset, min.y, max.z + offset);
        const hEnd = new THREE.Vector3(max.x + offset, max.y, max.z + offset);
        const hExtAStart = new THREE.Vector3(max.x, min.y, max.z);
        const hExtAEnd = hStart.clone();
        const hExtBStart = new THREE.Vector3(max.x, max.y, max.z);
        const hExtBEnd = hEnd.clone();
        const hLabel = makeLabel(formatLength(displayMm.height, modelUnitsRef.current), "h");
        measurementGroup.add(
          addDimension({
            start: hStart,
            end: hEnd,
            extAStart: hExtAStart,
            extAEnd: hExtAEnd,
            extBStart: hExtBStart,
            extBEnd: hExtBEnd,
            tickDir: new THREE.Vector3(1, 0, 0),
            label: hLabel,
          })
        );

        const tStart = new THREE.Vector3(min.x - offset, min.y, min.z);
        const tEnd = new THREE.Vector3(min.x - offset, min.y, max.z);
        const tExtAStart = new THREE.Vector3(min.x, min.y, min.z);
        const tExtAEnd = tStart.clone();
        const tExtBStart = new THREE.Vector3(min.x, min.y, max.z);
        const tExtBEnd = tEnd.clone();
        const tLabel = makeLabel(formatLength(displayMm.thickness, modelUnitsRef.current), "t");
        measurementGroup.add(
          addDimension({
            start: tStart,
            end: tEnd,
            extAStart: tExtAStart,
            extAEnd: tExtAEnd,
            extBStart: tExtBStart,
            extBEnd: tExtBEnd,
            tickDir: new THREE.Vector3(0, 1, 0),
            label: tLabel,
          })
        );

        measurementGroup.visible = !!showMeasurementsRef.current;
        scene.add(measurementGroup);
      }

      const scaledSize = maxDimension * modelGroup.scale.x;
      const distance = scaledSize * 1.5;

      camera.position.set(distance * 0.5, distance * 0.35, distance * 0.8);
      const target = modelBounds ? modelBounds.getCenter(new THREE.Vector3()) : new THREE.Vector3(0, 0, 0);
      camera.lookAt(target);
      controls.target.copy(target);
      controls.minDistance = distance * 0.3;
      controls.maxDistance = distance * 4;
      controls.update();

      setLoading(false);
      applyWeather(weatherRef.current);
    };

    const handleError = (err: any) => {
      console.error("3D model load error:", err);
      setLoading(false);
    };

    const manager = new THREE.LoadingManager();
    manager.onError = (url) => console.warn("Failed to load asset:", url);

    const fbxLoader = new FBXLoader(manager);
    fbxLoader.setCrossOrigin("anonymous");
    const gltfLoader = new GLTFLoader(manager);
    (gltfLoader as any).setCrossOrigin?.("anonymous");

    let objectURLToRevoke: string | null = null;

    const tryFetchAsObjectUrl = async (url: string): Promise<string | null> => {
      const tryUrls: string[] = [url];
      if (url.includes(" ")) tryUrls.push(encodeURI(url));
      for (const u of tryUrls) {
        try {
          const res = await fetch(u, { mode: "cors" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          objectURLToRevoke = URL.createObjectURL(blob);
          return objectURLToRevoke;
        } catch {
          // try next
        }
      }
      return null;
    };

    const loadModel = async () => {
      const ext = modelExt;

      const loadAsGLTF = (url: string) =>
        new Promise<void>((resolve, reject) => {
          gltfLoader.load(
            url,
            (gltf: any) => {
              const object = gltf?.scene as THREE.Object3D | undefined;
              if (!object) {
                reject(new Error("Missing gltf.scene"));
                return;
              }
              handleLoaded(object);
              resolve();
            },
            undefined,
            reject
          );
        });

      const loadAsFBX = (url: string) =>
        new Promise<void>((resolve, reject) => {
          fbxLoader.load(
            url,
            (object) => {
              handleLoaded(object);
              resolve();
            },
            undefined,
            reject
          );
        });

      if (ext === "gltf") {
        try {
          const base = new URL(currentUrl, window.location.href);
          base.search = "";
          base.hash = "";
          base.pathname = base.pathname.slice(0, base.pathname.lastIndexOf("/") + 1);
          manager.setURLModifier((requested) => {
            if (!requested) return requested;
            const lower = requested.toLowerCase();
            if (
              lower.startsWith("data:") ||
              lower.startsWith("blob:") ||
              lower.startsWith("http://") ||
              lower.startsWith("https://")
            )
              return requested;
            try {
              return new URL(requested, base).toString();
            } catch {
              return requested;
            }
          });
        } catch {}

        try {
          await loadAsGLTF(currentUrl);
        } catch (err) {
          handleError(err);
        }
        return;
      }

      let loadUrl = currentUrl;
      if (ext === "fbx" || ext === "glb") {
        const objUrl = await tryFetchAsObjectUrl(currentUrl);
        if (objUrl) loadUrl = objUrl;
      }

      if (ext === "fbx") {
        try {
          await loadAsFBX(loadUrl);
        } catch (err) {
          handleError(err);
        }
        return;
      }

      if (ext === "glb") {
        try {
          await loadAsGLTF(loadUrl);
        } catch (err) {
          handleError(err);
        }
        return;
      }

      try {
        const objUrl = await tryFetchAsObjectUrl(currentUrl);
        const candidate = objUrl || currentUrl;
        await loadAsFBX(candidate);
      } catch {
        try {
          const objUrl = await tryFetchAsObjectUrl(currentUrl);
          const candidate = objUrl || currentUrl;
          await loadAsGLTF(candidate);
        } catch (err) {
          handleError(err instanceof Error ? err : new Error(`Unsupported 3D model type: .${ext || "?"}`));
        }
      }
    };

    void loadModel();

    let rafId = 0;
    const animate = () => {
      frameCounter++;
      const heavyStep = frameCounter % (isLowEnd ? 4 : 3) === 0;

      const nowMs = performance.now();
      const dt = Math.min(0.05, (nowMs - lastFrameMs) / 1000);
      lastFrameMs = nowMs;

      if (measurementGroup) measurementGroup.visible = !!showMeasurementsRef.current;

      const shouldUpdateRain = !isLowEnd || heavyStep;
      if (shouldUpdateRain && rainSystem && rainVelY && rainVelX && rainLen && rainSwirlPhase && rainSwirlRadius && rainBaseX && rainBaseZ) {
        if (!rainArea || modelBounds) {
          rainArea = computeRainArea();
        }

        const posAttr = rainSystem.geometry.attributes.position as THREE.BufferAttribute;
        const arr = posAttr.array as Float32Array;
        const count = rainVelY.length;

        const t = nowMs * 0.001;
        for (let i = 0; i < count; i++) {
          const idx = i * 6;
          const gust = Math.sin(i * 0.013 + t * 1.7) * 0.4;
          rainSwirlPhase[i] += dt * (1.6 + i * 0.0007);
          const swirlX = Math.cos(rainSwirlPhase[i]) * rainSwirlRadius[i];
          const swirlZ = Math.sin(rainSwirlPhase[i]) * rainSwirlRadius[i];

          let headX = arr[idx + 0] + (rainVelX[i] + gust) * dt + swirlX * dt * 6;
          let headY = arr[idx + 1] - rainVelY[i] * dt;
          let headZ = arr[idx + 2] + swirlZ * dt * 5;

          const bounds = rainArea;
          if (bounds) {
            if (headY < bounds.minY) {
              const resetX = bounds.minX + Math.random() * (bounds.maxX - bounds.minX);
              const resetZ = bounds.minZ + Math.random() * (bounds.maxZ - bounds.minZ);
              rainBaseX[i] = resetX;
              rainBaseZ[i] = resetZ;
              rainSwirlPhase[i] = Math.random() * Math.PI * 2;
              rainSwirlRadius[i] = 0.35 + Math.random() * 1.8;
              headX = resetX;
              headY = bounds.maxY + Math.random() * (bounds.maxY - bounds.minY) * 0.25;
              headZ = resetZ;
            }

            if (headX < bounds.minX) headX = bounds.maxX;
            if (headX > bounds.maxX) headX = bounds.minX;
            if (headZ < bounds.minZ) headZ = bounds.maxZ;
            if (headZ > bounds.maxZ) headZ = bounds.minZ;
          }

          const len = rainLen[i];
          arr[idx + 0] = headX;
          arr[idx + 1] = headY;
          arr[idx + 2] = headZ;
          arr[idx + 3] = headX - (rainVelX[i] + gust) * 0.012 * len;
          arr[idx + 4] = headY - len;
          arr[idx + 5] = headZ - 0.01 * len;
        }

        posAttr.needsUpdate = true;
      }

      controls.update();
      renderer.render(scene, camera);
      if (labelRenderer) {
        try {
          labelRenderer.render(scene, camera);
        } catch {}
      }
      rafId = requestAnimationFrame(animate);
    };

    animate();

    const wheelHandler = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    try {
      renderer.domElement.addEventListener("wheel", wheelHandler, { passive: false });
    } catch {}

    return () => {
      applyWeatherRef.current = null;
      try {
        renderer.domElement.removeEventListener("wheel", wheelHandler as any);
      } catch {}
      cancelAnimationFrame(rafId);
      disposeMeasurementGroup();
      try {
        controls.dispose();
      } catch {}
      try {
        renderer.dispose();
      } catch {}
      if (objectURLToRevoke) {
        try {
          URL.revokeObjectURL(objectURLToRevoke);
        } catch {}
      }
      try {
        skyboxTex?.dispose();
      } catch {}
      if (labelRenderer) {
        try {
          container.removeChild(labelRenderer.domElement);
        } catch {}
      }
      while (container && container.firstChild) container.removeChild(container.firstChild);
    };
  }, [currentUrl, productDimsMm, usesProductDimensions, width, height]);

  if (!validUrls.length) {
    return (
      <div className="flex items-center justify-center w-full h-full bg-gray-100">
        <div className="text-center">
          <div className="text-gray-500 text-lg">No 3D models available</div>
        </div>
      </div>
    );
  }

  const goToPrevious = () => {
    if (validUrls.length > 1) setCurrentFbxIndex((i) => (i > 0 ? i - 1 : validUrls.length - 1));
  };

  const goToNext = () => {
    if (validUrls.length > 1) setCurrentFbxIndex((i) => (i < validUrls.length - 1 ? i + 1 : 0));
  };

  const goToIndex = (index: number) => {
    if (index >= 0 && index < validUrls.length) setCurrentFbxIndex(index);
  };

  return (
    <div className="relative w-full h-full">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 z-10">
          <div className="bg-white rounded-lg p-6 shadow-lg">
            <div className="flex items-center space-x-3">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <span className="text-lg font-medium">Loading 3D model...</span>
            </div>
          </div>
        </div>
      )}

      <div ref={mountRef} style={{ width: "100%", height: "100%" }} />

      <div className="absolute top-3 left-3 z-[9999] pointer-events-auto">
        <div className="bg-black/70 backdrop-blur-md rounded-xl px-4 py-3 shadow-lg text-white min-w-[220px]">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold">Measurements</div>
            <label className="flex items-center gap-2 text-xs text-white/90">
              <input type="checkbox" checked={showMeasurements} onChange={(e) => setShowMeasurements(e.target.checked)} />
              Show
            </label>
          </div>

          <div className="mt-2 grid grid-cols-1 gap-1 text-xs text-white/90">
            <div className="flex items-center justify-between gap-3">
              <span className="text-white/70">Width</span>
              <span className="font-semibold">{dimsMm ? formatLength(dimsMm.width, modelUnits) : "—"}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-white/70">Height</span>
              <span className="font-semibold">{dimsMm ? formatLength(dimsMm.height, modelUnits) : "—"}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-white/70">Thickness</span>
              <span className="font-semibold">{dimsMm ? formatLength(dimsMm.thickness, modelUnits) : "—"}</span>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <label className="text-xs text-white/70">Units</label>
            <select
              value={modelUnits}
              onChange={(e) => setModelUnits(e.target.value as ModelUnits)}
              className="gl-units-select bg-white/10 border border-white/20 rounded-lg px-2 py-1 text-xs text-white outline-none"
              aria-label="Model units"
            >
              <option value="mm">mm</option>
              <option value="cm">cm</option>
              <option value="m">m</option>
            </select>
          </div>

          <div className="mt-2 text-[11px] text-white/60 leading-snug">
            {usesProductDimensions
              ? "Using product dimensions (if provided). Use Units to convert display."
              : "Use Units to change measurement display."}
          </div>
        </div>
      </div>

      <style jsx>{`
        .gl-units-select option {
          color: #0f172a;
          background: #ffffff;
        }
      `}</style>

      {validUrls.length > 1 && (
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-[9999] pointer-events-auto">
          <div className="bg-black bg-opacity-80 backdrop-blur-sm rounded-lg p-4 shadow-lg">
            <div className="text-center mb-3">
              <div className="text-white text-sm font-medium">
                3D Model {currentFbxIndex + 1} of {validUrls.length}
              </div>
              <div className="text-gray-300 text-xs">{validUrls[currentFbxIndex]?.split("/").pop()?.split(".")[0] || `Model ${currentFbxIndex + 1}`}</div>
            </div>

            <div className="flex items-center justify-center space-x-4">
              <button
                onClick={goToPrevious}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                aria-label="Previous model"
              >
                ← Back
              </button>

              <div className="flex space-x-2">
                {validUrls.map((_, index) => (
                  <button
                    key={index}
                    onClick={() => goToIndex(index)}
                    className={`w-3 h-3 rounded-full transition-colors ${index === currentFbxIndex ? "bg-blue-500" : "bg-gray-400 hover:bg-gray-300"}`}
                    aria-label={`Go to model ${index + 1}`}
                  />
                ))}
              </div>

              <button
                onClick={goToNext}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
              >
                Next →
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}

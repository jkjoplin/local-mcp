import { execSync } from "node:child_process";
import { platform } from "node:os";

const SYSCTL = "/usr/sbin/sysctl";
const SYSTEM_PROFILER = "/usr/sbin/system_profiler";
const UNAME = "/usr/bin/uname";
const VM_STAT = "/usr/bin/vm_stat";

export type FitLevel = "perfect" | "good" | "marginal" | "too_large";
export type ModelTierLabel = "fast" | "smart";

export interface CuratedModel {
  id: string;
  name: string;
  ramGB: number;
  ram: string;
  speedTps: number;
  speed: string;
  bestFor: string;
  tags: string[];
  tier: ModelTierLabel;
  recommended?: boolean;
  preference: number;
}

export interface HardwareModelFit extends CuratedModel {
  fit: FitLevel;
}

export interface HardwareInfo {
  cpu: string;
  isAppleSilicon: boolean;
  totalRamGB: number;
  freeRamGB: number;
  gpuName: string | null;
  vramGB: number | null;
  models: HardwareModelFit[];
  recommended: {
    smart: string | null;
    fast: string | null;
  };
}

export const CURATED_MODELS: CuratedModel[] = [
  {
    id: "mlx-community/Qwen2.5-1.5B-Instruct-4bit",
    name: "Qwen2.5-1.5B-Instruct-4bit",
    ramGB: 1,
    ram: "1 GB",
    speedTps: 215,
    speed: "215 t/s",
    bestFor: "Ultra-fast: classification & extraction",
    tags: ["fast", "classification", "extraction"],
    tier: "fast",
    preference: 100,
  },
  {
    id: "mlx-community/Qwen2.5-7B-Instruct-4bit",
    name: "Qwen2.5-7B-Instruct-4bit",
    ramGB: 4.4,
    ram: "4.4 GB",
    speedTps: 60,
    speed: "60 t/s",
    bestFor: "General Q&A, structured output",
    tags: ["general", "qa", "structured"],
    tier: "fast",
    preference: 80,
  },
  {
    id: "mlx-community/Qwen3.5-9B-MLX-4bit",
    name: "Qwen3.5-9B-MLX-4bit",
    ramGB: 5.6,
    ram: "5.6 GB",
    speedTps: 52,
    speed: "52 t/s",
    bestFor: "Reasoning & hard prompts",
    tags: ["reasoning", "smart", "recommended"],
    tier: "smart",
    recommended: true,
    preference: 120,
  },
  {
    id: "mlx-community/Qwen3-14B-4bit",
    name: "Qwen3-14B-4bit",
    ramGB: 8.4,
    ram: "8.4 GB",
    speedTps: 29,
    speed: "29 t/s",
    bestFor: "Mid-tier reasoning",
    tags: ["reasoning", "mid-tier"],
    tier: "smart",
    preference: 90,
  },
  {
    id: "mlx-community/Qwen3.5-27B-4bit",
    name: "Qwen3.5-27B-4bit",
    ramGB: 15.3,
    ram: "15.3 GB",
    speedTps: 16,
    speed: "16 t/s",
    bestFor: "Max quality on-device",
    tags: ["quality", "max"],
    tier: "smart",
    preference: 70,
  },
  {
    id: "mlx-community/gemma-3-12b-it-4bit",
    name: "gemma-3-12b-it-4bit",
    ramGB: 7.3,
    ram: "7.3 GB",
    speedTps: 30,
    speed: "30 t/s",
    bestFor: "Vision & OCR",
    tags: ["vision", "ocr", "multimodal"],
    tier: "smart",
    preference: 85,
  },
  {
    id: "mlx-community/Phi-4-reasoning-plus-4bit",
    name: "Phi-4-reasoning-plus-4bit",
    ramGB: 9.7,
    ram: "9.7 GB",
    speedTps: 26,
    speed: "26 t/s",
    bestFor: "Deep math & reasoning",
    tags: ["reasoning", "math", "deep"],
    tier: "smart",
    preference: 88,
  },
];

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function toGB(bytes: number): number {
  return round1(bytes / (1024 ** 3));
}

function parseVmStatPages(text: string): { pageSize: number; values: Record<string, number> } {
  const sizeMatch = text.match(/page size of (\d+) bytes/);
  const pageSize = sizeMatch ? parseInt(sizeMatch[1], 10) : 4096;
  const values: Record<string, number> = {};

  for (const line of text.split("\n")) {
    const match = line.match(/^([^:]+):\s+([\d.]+)\./);
    if (match) {
      const key = match[1].trim();
      if (key.startsWith("Pages ")) {
        values[key] = parseFloat(match[2]);
      }
    }
  }

  return { pageSize, values };
}

function parseLinuxMeminfo(text: string): { totalKB: number; freeKB: number } {
  let totalKB = 0;
  let freeKB = 0;

  for (const line of text.split("\n")) {
    if (line.startsWith("MemTotal:")) {
      totalKB = parseInt(line.replace(/\D+/g, " ").trim().split(" ")[0] ?? "0", 10);
    }
    if (line.startsWith("MemAvailable:")) {
      freeKB = parseInt(line.replace(/\D+/g, " ").trim().split(" ")[0] ?? "0", 10);
    }
  }

  return { totalKB, freeKB };
}

function detectMemory(): { totalRamGB: number; freeRamGB: number } {
  if (platform() === "darwin") {
    const vmStat = execSync(VM_STAT, { encoding: "utf-8" });
    const { pageSize, values } = parseVmStatPages(vmStat);
    const totalPages =
      (values["Pages free"] ?? 0) +
      (values["Pages active"] ?? 0) +
      (values["Pages inactive"] ?? 0) +
      (values["Pages speculative"] ?? 0) +
      (values["Pages throttled"] ?? 0) +
      (values["Pages wired down"] ?? 0) +
      (values["Pages occupied by compressor"] ?? 0);
    const freePages =
      (values["Pages free"] ?? 0) +
      (values["Pages inactive"] ?? 0) +
      (values["Pages speculative"] ?? 0);

    return {
      totalRamGB: toGB(totalPages * pageSize),
      freeRamGB: toGB(freePages * pageSize),
    };
  }

  const meminfo = execSync("cat /proc/meminfo", { encoding: "utf-8" });
  const { totalKB, freeKB } = parseLinuxMeminfo(meminfo);
  return {
    totalRamGB: round1(totalKB / (1024 ** 2)),
    freeRamGB: round1(freeKB / (1024 ** 2)),
  };
}

function detectCpu(): { cpu: string; isAppleSilicon: boolean } {
  if (platform() === "darwin") {
    let cpu = "";

    try {
      const chip = execSync(`${SYSTEM_PROFILER} SPHardwareDataType | grep "Chip:"`, {
        env: process.env,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 1024 * 1024 * 4,
        shell: "/bin/zsh",
      })
        .replace(/^.*Chip:\s*/m, "")
        .trim();
      if (chip) {
        cpu = chip;
      }
    } catch {
      // Fall through to sysctl checks
    }

    try {
      if (!cpu) {
        cpu = execSync(`${SYSCTL} -n machdep.cpu.brand_string`, {
          env: process.env,
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim();
      }
    } catch {
      // Fall through to hw.model
    }

    if (!cpu) {
      try {
        cpu = execSync(`${SYSCTL} -n hw.model`, {
          env: process.env,
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim();
      } catch {
        cpu = "Unknown CPU";
      }
    }

    let isAppleSilicon = false;
    try {
      isAppleSilicon =
        execSync(`${SYSCTL} -n hw.optional.arm64`, {
          env: process.env,
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim() === "1";
    } catch {
      // Fall through to uname
    }

    if (!isAppleSilicon) {
      try {
        isAppleSilicon =
          execSync(`${UNAME} -m`, {
            env: process.env,
            encoding: "utf-8",
            stdio: ["ignore", "pipe", "ignore"],
          }).trim() === "arm64";
      } catch {
        // Keep false
      }
    }

    return { cpu: cpu || "Unknown CPU", isAppleSilicon };
  }

  const cpuinfo = execSync("cat /proc/cpuinfo", { encoding: "utf-8" });
  const match = cpuinfo.match(/^model name\s*:\s*(.+)$/m);
  const cpu = match?.[1]?.trim() ?? "Unknown CPU";
  return { cpu, isAppleSilicon: false };
}

function parseVramGB(value: string): number | null {
  const match = value.match(/([\d.]+)\s*(GB|MB)/i);
  if (!match) return null;
  const amount = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  return round1(unit === "MB" ? amount / 1024 : amount);
}

function detectGpu(): { gpuName: string | null; vramGB: number | null } {
  if (platform() !== "darwin") {
    return { gpuName: null, vramGB: null };
  }

  try {
    const raw = execSync(`${SYSTEM_PROFILER} SPDisplaysDataType`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 1024 * 1024 * 4,
    });
    const chipMatch = raw.match(/Chipset Model:\s*(.+)/);
    const vramMatch =
      raw.match(/VRAM(?: \(Dynamic, Max\))?:\s*(.+)/) ??
      raw.match(/VRAM \(Total\):\s*(.+)/);

    return {
      gpuName: chipMatch?.[1]?.trim() ?? null,
      vramGB: vramMatch ? parseVramGB(vramMatch[1].trim()) : null,
    };
  } catch {
    return { gpuName: null, vramGB: null };
  }
}

export function scoreModelFit(totalRamGB: number, ramGB: number): FitLevel {
  if (ramGB < totalRamGB * 0.5) return "perfect";
  if (ramGB < totalRamGB * 0.7) return "good";
  if (ramGB < totalRamGB * 0.85) return "marginal";
  return "too_large";
}

function chooseRecommended(models: HardwareModelFit[]): HardwareInfo["recommended"] {
  const viable = models.filter((model) => model.fit === "perfect" || model.fit === "good");
  const smart = viable
    .filter((model) => model.tier === "smart")
    .sort((a, b) => b.preference - a.preference || b.ramGB - a.ramGB)[0];
  const fast = viable
    .filter((model) => model.tier === "fast")
    .sort((a, b) => b.speedTps - a.speedTps || b.preference - a.preference)[0];

  return {
    smart: smart?.id ?? null,
    fast: fast?.id ?? null,
  };
}

export function detectHardware(): HardwareInfo {
  const { totalRamGB, freeRamGB } = detectMemory();
  const { cpu, isAppleSilicon } = detectCpu();
  const detectedGpu = detectGpu();
  const gpuName = isAppleSilicon ? cpu : detectedGpu.gpuName;
  const vramGB = isAppleSilicon ? totalRamGB : detectedGpu.vramGB;
  const models = CURATED_MODELS.map((model) => ({
    ...model,
    fit: scoreModelFit(totalRamGB, model.ramGB),
  }));

  return {
    cpu,
    isAppleSilicon,
    totalRamGB,
    freeRamGB,
    gpuName,
    vramGB,
    models,
    recommended: chooseRecommended(models),
  };
}

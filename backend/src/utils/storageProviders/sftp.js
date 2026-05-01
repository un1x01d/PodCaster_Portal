import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import {
  PROVIDER_TIMEOUT_MS,
  trimString,
  parsePositiveInt,
  decryptSettingValue,
} from "./common.js";

function sanitizeSftpSourceRef(sourceRef) {
  const text = trimString(sourceRef);
  if (!text) throw new Error("sftp_source_ref_required");
  if (text.length > 1024) throw new Error("sftp_source_ref_invalid");
  if (/[\u0000-\u001f\u007f]/.test(text)) throw new Error("sftp_source_ref_invalid");
  if (/^\-/.test(text)) throw new Error("sftp_source_ref_invalid");
  if (/\.\./.test(text)) throw new Error("sftp_source_ref_invalid");
  if (/[`$;&|<>]/.test(text)) throw new Error("sftp_source_ref_invalid");
  if (/[\r\n\t]/.test(text)) throw new Error("sftp_source_ref_invalid");
  return text;
}

function quoteScpRemotePath(pathText) {
  const raw = String(pathText || "");
  return `'${raw.replaceAll("'", `'\\''`)}'`;
}

function buildSshAuthContext(cfg) {
  const host = trimString(cfg?.host);
  const username = trimString(cfg?.username);
  const port = parsePositiveInt(cfg?.port) || 22;
  if (!host || !username) return null;

  const args = [
    "-o", "BatchMode=no", "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=10",
    "-o", "ServerAliveInterval=5", "-o", "ServerAliveCountMax=1", "-p", String(port),
  ];

  const env = { ...process.env };
  const cleanup = [];
  if (trimString(cfg?.authMode, "password") === "ssh_key") {
    const privateKey = trimString(decryptSettingValue(String(cfg?.privateKey || "")));
    if (!privateKey) return null;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "storage-sftp-"));
    const keyPath = path.join(tmpDir, "id_rsa");
    fs.writeFileSync(keyPath, privateKey, { mode: 0o600 });
    cleanup.push(() => {
      try { fs.unlinkSync(keyPath); } catch {}
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    });
    args.push("-i", keyPath, "-o", "IdentitiesOnly=yes", "-o", "PreferredAuthentications=publickey");
    const passphrase = trimString(decryptSettingValue(String(cfg?.passphrase || "")));
    if (passphrase) {
      const scriptPath = path.join(tmpDir, "askpass.sh");
      fs.writeFileSync(scriptPath, `#!/bin/sh\nprintf '%s\\n' "${passphrase.replaceAll("\"", "\\\"")}"\n`, { mode: 0o700 });
      cleanup.push(() => {
        try { fs.unlinkSync(scriptPath); } catch {}
      });
      env.SSH_ASKPASS = scriptPath;
      env.SSH_ASKPASS_REQUIRE = "force";
      env.DISPLAY = env.DISPLAY || "codex";
    }
  } else {
    const password = trimString(decryptSettingValue(String(cfg?.password || "")));
    if (!password) return null;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "storage-sftp-"));
    const scriptPath = path.join(tmpDir, "askpass.sh");
    fs.writeFileSync(scriptPath, `#!/bin/sh\nprintf '%s\\n' "${password.replaceAll("\"", "\\\"")}"\n`, { mode: 0o700 });
    cleanup.push(() => {
      try { fs.unlinkSync(scriptPath); } catch {}
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    });
    env.SSH_ASKPASS = scriptPath;
    env.SSH_ASKPASS_REQUIRE = "force";
    env.DISPLAY = env.DISPLAY || "codex";
    args.push("-o", "PreferredAuthentications=password,keyboard-interactive", "-o", "PubkeyAuthentication=no");
  }

  return { host, username, target: `${username}@${host}`, port, args, env, cleanup };
}

async function runSshCommand(cfg, remoteArgs, timeoutMs = PROVIDER_TIMEOUT_MS) {
  const ctx = buildSshAuthContext(cfg);
  if (!ctx) return { ok: false, error: "sftp_not_configured" };
  try {
    const proc = spawn("ssh", [...ctx.args, ctx.target, ...remoteArgs], { env: ctx.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => proc.kill("SIGKILL"), timeoutMs);
    proc.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    return await new Promise((resolve) => {
      proc.on("error", (err) => {
        clearTimeout(timeout);
        resolve({ ok: false, error: err?.message || "ssh_command_unavailable", stdout, stderr });
      });
      proc.on("close", (code) => {
        clearTimeout(timeout);
        resolve({ ok: code === 0, code, stdout, stderr });
      });
    });
  } finally {
    for (const cleanupFn of ctx.cleanup || []) {
      try { cleanupFn(); } catch {}
    }
  }
}

export async function listSftpEntries(cfg, currentPath) {
  const pathArg = trimString(currentPath, trimString(cfg?.remotePath, ".") || ".");
  const result = await runSshCommand(cfg, [
    "find", pathArg, "-mindepth", "1", "-maxdepth", "1", "-printf", "%y\\t%P\\t%p\\t%s\\t%TY-%Tm-%TdT%TH:%TM:%TS\\n",
  ]);
  if (!result.ok) {
    const text = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
    throw new Error(`sftp_list_failed: ${text.slice(0, 400)}`);
  }
  const entries = String(result.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [kind, relName = "", fullPath = "", size = "0", updatedAt = ""] = line.split("\t");
      const isFolder = kind === "d";
      const name = relName || path.basename(fullPath);
      const resolvedPath = fullPath || (path.posix.join(pathArg, name));
      return { id: resolvedPath, name, path: resolvedPath, isFolder, size: Number.parseInt(size, 10) || 0, updatedAt: updatedAt || null };
    })
    .filter((entry) => entry.id);
  return { entries, path: pathArg };
}

export async function fetchSftpMetadata(cfg, sourceRef) {
  const filePath = sanitizeSftpSourceRef(sourceRef);
  const result = await runSshCommand(cfg, ["stat", "-c", "%Y\\t%s\\t%n", filePath]);
  if (!result.ok) {
    const text = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
    throw new Error(`sftp_metadata_failed: ${text.slice(0, 400)}`);
  }
  const [mtime = "", size = "", name = ""] = String(result.stdout || "").trim().split("\t");
  return {
    provider: "sftp_storage",
    sourceRef: filePath,
    remoteMarker: [mtime, size].filter(Boolean).join("|") || filePath,
    remoteModifiedAt: mtime ? new Date(Number.parseInt(mtime, 10) * 1000).toISOString() : null,
    originalName: path.basename(name || filePath || "sftp-file"),
    sftpPath: filePath,
  };
}

export async function downloadSftpFile(cfg, sourceRef) {
  const ctx = buildSshAuthContext(cfg);
  if (!ctx) throw new Error("sftp_not_configured");
  const filePath = sanitizeSftpSourceRef(sourceRef);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "storage-sftp-dl-"));
  const localPath = path.join(tmpDir, path.basename(filePath) || "download.xlsx");
  try {
    const remotePathArg = `${ctx.target}:${quoteScpRemotePath(filePath)}`;
    const scpArgs = [...ctx.args, "-q", remotePathArg, localPath];
    const proc = spawn("scp", scpArgs, { env: ctx.env, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    const code = await new Promise((resolve) => {
      const timeout = setTimeout(() => proc.kill("SIGKILL"), PROVIDER_TIMEOUT_MS);
      proc.on("error", () => {
        clearTimeout(timeout);
        resolve(-1);
      });
      proc.on("close", (exitCode) => {
        clearTimeout(timeout);
        resolve(exitCode);
      });
    });
    if (code !== 0) throw new Error(`sftp_download_failed: ${String(stderr || "").slice(0, 400)}`);
    const buf = await fs.promises.readFile(localPath);
    const lowerName = filePath.toLowerCase();
    return {
      buffer: buf,
      mimeType: "application/octet-stream",
      extension: lowerName.endsWith(".csv") ? ".csv" : (lowerName.endsWith(".xls") ? ".xls" : ".xlsx"),
      originalName: path.basename(filePath),
      sftpPath: filePath,
    };
  } finally {
    try { await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch {}
    for (const cleanupFn of ctx.cleanup || []) {
      try { cleanupFn(); } catch {}
    }
  }
}

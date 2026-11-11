import "server-only";
import { timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { sha256 } from "./hash";
import { MjIntegrationError } from "./errors";

export type MjIntegrationPrincipal = { clientId: string; clientCode: string; environment: string; tokenId: string };

function tokenPrefix(token: string) {
  const parts = token.split("_");
  return parts.length >= 4 && parts[0] === "slm" ? parts[2] : "";
}

function equalHash(left: string, right: string) {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

function limitFor(bucket: "mutation" | "read") {
  const key = bucket === "mutation" ? "MJ_RATE_LIMIT_MUTATION_PER_MINUTE" : "MJ_RATE_LIMIT_READ_PER_MINUTE";
  const fallback = bucket === "mutation" ? 60 : 300;
  const parsed = Number(process.env[key] || fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function enforceRateLimit(clientId: string, bucket: "mutation" | "read") {
  const now = new Date();
  const windowStart = new Date(now);
  windowStart.setUTCSeconds(0, 0);
  const row = await prisma.integrationRateLimit.upsert({
    where: { clientId_bucket_windowStart: { clientId, bucket, windowStart } },
    create: { id: crypto.randomUUID(), clientId, bucket, windowStart, requestCount: 1 },
    update: { requestCount: { increment: 1 } }
  });
  const limit = limitFor(bucket);
  if (row.requestCount > limit) throw new MjIntegrationError("RATE_LIMITED", "Batas request integrasi terlampaui.", 429, { limit, bucket, retry_after_seconds: 60 - now.getUTCSeconds() });
  return { limit, remaining: Math.max(0, limit - row.requestCount) };
}

/**
 * Token permanen (tanpa masa berlaku) untuk MJ: token asli disimpan di .env MJ (SLM_API_TOKEN), di .env SLM
 * hanya hash bcrypt-nya (MJ_INTEGRATION_TOKEN_BCRYPT). Dibuat dengan `node scripts/generate-mj-token.mjs`.
 * Hasil cocok/tidak disimpan di memori supaya bcrypt tidak dihitung ulang di setiap request.
 */
const envTokenCache = new Map<string, boolean>();
let warnedBadHash = false;

function envTokenHash() {
  const raw = String(process.env.MJ_INTEGRATION_TOKEN_BCRYPT || "").trim().replace(/^'(.*)'$/, "$1").replace(/^"(.*)"$/, "$1");
  if (!raw) return "";
  if (!/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(raw)) {
    if (!warnedBadHash) console.error("[mj-auth] MJ_INTEGRATION_TOKEN_BCRYPT bukan hash bcrypt yang utuh. Bungkus nilainya dengan tanda kutip tunggal di .env supaya tanda $ tidak hilang.");
    warnedBadHash = true;
    return "";
  }
  return raw;
}

async function matchesEnvToken(rawToken: string) {
  const hash = envTokenHash();
  if (!hash) return false;
  const key = `${hash}:${sha256(rawToken)}`;
  const cached = envTokenCache.get(key);
  if (cached !== undefined) return cached;
  const ok = await bcrypt.compare(rawToken, hash);
  if (envTokenCache.size > 1000) envTokenCache.clear();
  envTokenCache.set(key, ok);
  return ok;
}

export async function authenticateMjRequest(request: Request, bucket: "mutation" | "read"): Promise<MjIntegrationPrincipal> {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) throw new MjIntegrationError("AUTH_INVALID", "Bearer token tidak valid.", 401);
  const rawToken = match[1];
  const prefix = tokenPrefix(rawToken);
  const candidates = prefix ? await prisma.integrationToken.findMany({ where: { prefix }, include: { client: true } }) : [];
  const requestedHash = sha256(rawToken);
  const token = candidates.find((candidate) => equalHash(candidate.tokenHash, requestedHash));
  const now = new Date();
  if (!token) equalHash("0".repeat(64), requestedHash);
  const expectedEnvironment = String(process.env.MJ_INTEGRATION_ENVIRONMENT || (process.env.NEXT_PUBLIC_APP_MODE === "production" ? "production" : "sandbox")).toLowerCase();
  if (!token && rawToken.split("_")[1] === expectedEnvironment && (await matchesEnvToken(rawToken))) {
    const client = await prisma.integrationClient.upsert({
      where: { code: `mj-${expectedEnvironment}` },
      create: { id: crypto.randomUUID(), code: `mj-${expectedEnvironment}`, name: "Majoo (MJ)", environment: expectedEnvironment },
      update: {}
    });
    // Client yang dinonaktifkan Super Admin tetap memblokir token permanen.
    if (!client.isActive || client.environment !== expectedEnvironment) throw new MjIntegrationError("AUTH_INVALID", "Bearer token tidak valid, kedaluwarsa, atau dicabut.", 401);
    await enforceRateLimit(client.id, bucket);
    return { clientId: client.id, clientCode: client.code, environment: expectedEnvironment, tokenId: "env:MJ_INTEGRATION_TOKEN_BCRYPT" };
  }
  if (!token || !token.isActive || token.revokedAt || (token.expiresAt && token.expiresAt <= now) || !token.client.isActive || token.environment !== token.client.environment || token.environment !== expectedEnvironment) {
    throw new MjIntegrationError("AUTH_INVALID", "Bearer token tidak valid, kedaluwarsa, atau dicabut.", 401);
  }
  await enforceRateLimit(token.clientId, bucket);
  await prisma.integrationToken.update({ where: { id: token.id }, data: { lastUsedAt: now } });
  return { clientId: token.clientId, clientCode: token.client.code, environment: token.environment, tokenId: token.id };
}

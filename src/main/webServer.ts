/**
 * Copyright (c) 2022 BlockDev AG
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import * as crypto from "crypto"
import * as fs from "fs"
import * as http from "http"
import * as os from "os"
import * as path from "path"

import { app } from "electron"
import _ from "lodash"
import * as termsPackageJson from "@mysteriumnetwork/terms/package.json"
import { TequilapiClient, TequilapiClientFactory } from "mysterium-vpn-js"

import * as packageJson from "../../package.json"
import { parseError } from "../shared/errors/parseError"
import { log } from "../shared/log/log"
import { staticAssetPath } from "../utils/paths"
import { TEQUILAPI_PORT } from "../app/tequilapi"

import { cliFlags } from "./cliFlags"
import { mysteriumNode } from "./node/mysteriumNode"

const DEFAULT_WEB_UI_PORT = 44051
const LOCAL_PROXY_PORT = 4449
const NODE_GHOST_PORTS = [4050, TEQUILAPI_PORT]
const REQUEST_BODY_LIMIT_BYTES = 10 * 1024 * 1024

type JsonObject = { [key: string]: unknown }
type RequestHandler = (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => Promise<void>

interface OptionalResult<T> {
    ok: boolean
    data?: T
    error?: string
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const parsePort = (value?: string): number | undefined => {
    if (!value) {
        return undefined
    }
    const port = Number(value)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`Invalid web UI port: ${value}`)
    }
    return port
}

const safeFilenamePart = (value: string): string => value.replace(/[^a-zA-Z0-9_.-]/g, "_")

export class LocalWebServer {
    private readonly tequilapi: TequilapiClient
    private server?: http.Server
    private events: string[] = []
    port = DEFAULT_WEB_UI_PORT
    url = `http://127.0.0.1:${DEFAULT_WEB_UI_PORT}/`

    constructor() {
        this.tequilapi = new TequilapiClientFactory(`http://127.0.0.1:${TEQUILAPI_PORT}`, 8_000).build()
    }

    async start(): Promise<void> {
        if (this.server) {
            return
        }

        const configuredPort = parsePort(
            process.env.MYST_WEB_UI_PORT || app.commandLine.getSwitchValue(cliFlags.WEB_UI_PORT),
        )
        const fixedPort = configuredPort != null
        const requestedPort = configuredPort ?? DEFAULT_WEB_UI_PORT

        try {
            await this.listen(requestedPort)
        } catch (err) {
            if (fixedPort || (err as NodeJS.ErrnoException).code !== "EADDRINUSE") {
                throw err
            }
            log.warn(`Web UI port ${requestedPort} is in use, falling back to a free loopback port`)
            await this.listen(0)
        }

        this.record(`Web UI listening on ${this.url}`)
    }

    async stop(): Promise<void> {
        if (!this.server) {
            return
        }
        await new Promise<void>((resolve, reject) => {
            this.server?.close((err) => (err ? reject(err) : resolve()))
        })
        this.server = undefined
    }

    async startNode(): Promise<JsonObject> {
        if (await this.isNodeUp()) {
            this.record("Myst node is already running")
            return this.status()
        }
        this.record("Starting Myst node in local proxy mode")
        await Promise.all(NODE_GHOST_PORTS.map((port) => mysteriumNode.killGhost(port)))
        await mysteriumNode.start(TEQUILAPI_PORT)
        await this.waitForNode()
        this.record("Myst node is ready")
        return this.status()
    }

    async stopNode(): Promise<JsonObject> {
        this.record("Stopping Myst node")
        await mysteriumNode.stop()
        return this.status()
    }

    async status(): Promise<JsonObject> {
        const health = await this.optional(() => this.tequilapi.healthCheck(1_500))
        const nodeUp = health.ok
        const connection = nodeUp ? await this.optional(() => this.tequilapi.connectionStatus()) : this.downResult()
        const identity = nodeUp ? await this.optional(() => this.identitySnapshot()) : this.downResult()
        const config = nodeUp ? await this.optional(() => this.loadConfig()) : this.downResult()
        const location = nodeUp ? await this.optional(() => this.tequilapi.location()) : this.downResult()
        const connectionLocation = nodeUp
            ? await this.optional(() => this.tequilapi.connectionLocation())
            : this.downResult()
        const nat = nodeUp ? await this.optional(() => this.tequilapi.natType()) : this.downResult()
        const presets = nodeUp ? await this.optional(() => this.proposalPresets()) : this.downResult()

        return {
            app: {
                name: packageJson.productName,
                version: packageJson.version,
                platform: os.platform(),
                webUiUrl: this.url,
                webUiPort: this.port,
                tequilapiUrl: `http://127.0.0.1:${TEQUILAPI_PORT}`,
                proxyHost: "127.0.0.1",
                proxyPort: LOCAL_PROXY_PORT,
                termsVersion: termsPackageJson.version,
            },
            node: {
                up: nodeUp,
                health,
            },
            connection,
            identity,
            config,
            location,
            connectionLocation,
            nat,
            presets,
        }
    }

    private listen(port: number): Promise<void> {
        this.server = http.createServer((req, res) => {
            this.handleRequest(req, res).catch((err) => this.sendError(res, err))
        })
        return new Promise((resolve, reject) => {
            const server = this.server
            if (!server) {
                reject(new Error("Web server was not created"))
                return
            }
            server.once("error", reject)
            server.listen(port, "127.0.0.1", () => {
                server.off("error", reject)
                const address = server.address()
                if (typeof address === "object" && address) {
                    this.port = address.port
                    this.url = `http://127.0.0.1:${address.port}/`
                }
                resolve()
            })
        })
    }

    private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        if (!this.isAllowedHost(req.headers.host)) {
            this.sendJson(res, 403, { error: "Forbidden host" })
            return
        }
        const requestUrl = new URL(req.url || "/", this.url)
        const route = `${req.method ?? "GET"} ${requestUrl.pathname}`
        const routes: { [route: string]: RequestHandler } = {
            "GET /": this.serveIndex,
            "GET /index.html": this.serveIndex,
            "GET /api/status": this.handleStatus,
            "GET /api/proposals": this.handleProposals,
            "GET /api/logs": this.handleLogs,
            "POST /api/node/start": this.handleNodeStart,
            "POST /api/node/stop": this.handleNodeStop,
            "POST /api/connect": this.handleConnect,
            "POST /api/connect/quick": this.handleQuickConnect,
            "POST /api/disconnect": this.handleDisconnect,
            "POST /api/identity/create": this.handleIdentityCreate,
            "POST /api/identity/unlock": this.handleIdentityUnlock,
            "POST /api/identity/register": this.handleIdentityRegister,
            "POST /api/identity/refresh-balance": this.handleBalanceRefresh,
            "POST /api/identity/export": this.handleIdentityExport,
            "POST /api/identity/import": this.handleIdentityImport,
            "POST /api/config": this.handleConfigUpdate,
        }
        const handler = routes[route]
        if (!handler) {
            this.sendJson(res, 404, { error: "Not found" })
            return
        }
        await handler(req, res, requestUrl)
    }

    private serveIndex = async (_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
        const indexPath = staticAssetPath("web-ui/index.html")
        const html = await fs.promises.readFile(indexPath)
        res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Frame-Options": "DENY",
        })
        res.end(html)
    }

    private handleStatus = async (_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
        this.sendJson(res, 200, await this.status())
    }

    private handleNodeStart = async (_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
        this.sendJson(res, 200, await this.startNode())
    }

    private handleNodeStop = async (_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
        this.sendJson(res, 200, await this.stopNode())
    }

    private handleProposals = async (_req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> => {
        const config = await this.loadConfig().catch(() => ({ desktop: {} }))
        const autoNat = _.get(config, ["desktop", "nat-compatibility"]) !== "off"
        const query: JsonObject = { serviceType: "wireguard" }
        const quality = url.searchParams.get("quality")
        const country = url.searchParams.get("country")
        const search = url.searchParams.get("search")?.toLowerCase()
        const includeFailed = url.searchParams.get("includeFailed") === "true"
        if (quality) {
            query.qualityMin = Number(quality)
        }
        if (includeFailed) {
            query.includeMonitoringFailed = true
        }
        if (autoNat) {
            const nat = await this.tequilapi.natType().catch(() => undefined)
            if (nat?.type) {
                query.natCompatibility = nat.type
            }
        }

        let proposals = await this.tequilapi.findProposals(query as any)
        if (country) {
            proposals = proposals.filter((proposal) => proposal.location?.country === country)
        }
        if (search) {
            proposals = proposals.filter((proposal) => proposal.providerId.toLowerCase().includes(search))
        }
        this.sendJson(res, 200, {
            query,
            items: proposals.map((proposal) => ({
                ...proposal,
                country: proposal.location?.country ?? "unknown",
                ipType: proposal.location?.ipType ?? "unknown",
                key: proposal.providerId,
                shortId: proposal.providerId.substring(0, 14),
            })),
        })
    }

    private handleConnect = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
        const body = await this.readJson(req)
        const providerId = String(body.providerId || "")
        if (!providerId) {
            this.sendJson(res, 400, { error: "providerId is required" })
            return
        }
        await this.connectToProvider(providerId, String(body.serviceType || "wireguard"), String(body.dns || ""))
        this.record(`Connection requested for provider ${providerId}`)
        this.sendJson(res, 200, await this.status())
    }

    private handleQuickConnect = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
        const body = await this.readJson(req)
        const proposals = await this.tequilapi.findProposals({ serviceType: "wireguard" } as any)
        const country = body.country ? String(body.country) : undefined
        const filtered = country ? proposals.filter((proposal) => proposal.location?.country === country) : proposals
        const proposal = filtered[0]
        if (!proposal) {
            this.sendJson(res, 404, { error: "No provider proposals are available" })
            return
        }
        await this.connectToProvider(proposal.providerId, proposal.serviceType || "wireguard")
        this.record(`Quick connect requested for provider ${proposal.providerId}`)
        this.sendJson(res, 200, await this.status())
    }

    private handleDisconnect = async (_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
        await this.tequilapi.connectionCancel()
        this.record("Disconnect requested")
        this.sendJson(res, 200, await this.status())
    }

    private handleIdentityCreate = async (_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
        await this.tequilapi.identityCreate("")
        this.record("Identity create requested")
        this.sendJson(res, 200, await this.status())
    }

    private handleIdentityUnlock = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
        const body = await this.readJson(req)
        const id = String(body.id || (await this.currentIdentity()).id)
        await this.tequilapi.identityUnlock(id, String(body.passphrase || ""), 10_000)
        this.sendJson(res, 200, await this.status())
    }

    private handleIdentityRegister = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
        const body = await this.readJson(req)
        const identity = await this.currentIdentity()
        const referralToken = body.referralToken ? String(body.referralToken) : undefined
        await this.tequilapi.identityRegister(identity.id, { stake: 0, referralToken } as any)
        this.record(`Registration requested for identity ${identity.id}`)
        this.sendJson(res, 200, await this.status())
    }

    private handleBalanceRefresh = async (_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
        const identity = await this.currentIdentity()
        await this.tequilapi.identityBalanceRefresh(identity.id)
        this.sendJson(res, 200, await this.status())
    }

    private handleIdentityExport = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
        const body = await this.readJson(req)
        const identity = body.id ? { id: String(body.id) } : await this.currentIdentity()
        const filename = path.join(
            app.getPath("temp"),
            `myst-identity-${safeFilenamePart(identity.id)}-${Date.now()}.json`,
        )
        try {
            const result = await mysteriumNode.exportIdentity({
                id: identity.id,
                passphrase: String(body.passphrase || ""),
                filename,
            })
            if (result.error) {
                throw new Error(result.error)
            }
            const content = await fs.promises.readFile(filename)
            res.writeHead(200, {
                "Content-Type": "application/json",
                "Content-Disposition": `attachment; filename="${safeFilenamePart(identity.id)}.json"`,
                "Cache-Control": "no-store",
            })
            res.end(content)
        } finally {
            fs.promises.unlink(filename).catch(() => undefined)
        }
    }

    private handleIdentityImport = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
        const body = await this.readJson(req)
        const content = String(body.content || "")
        if (!content) {
            this.sendJson(res, 400, { error: "Identity file content is required" })
            return
        }
        const filename = path.join(
            app.getPath("temp"),
            `myst-identity-import-${crypto.randomBytes(8).toString("hex")}.json`,
        )
        try {
            await fs.promises.writeFile(filename, content, { encoding: "utf8", mode: 0o600 })
            const result = await mysteriumNode.importIdentity({
                filename,
                passphrase: String(body.passphrase || ""),
            })
            if (result.error) {
                throw new Error(result.error)
            }
            this.record("Identity import requested")
            this.sendJson(res, 200, await this.status())
        } finally {
            fs.promises.unlink(filename).catch(() => undefined)
        }
    }

    private handleConfigUpdate = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
        const patch = await this.readJson(req)
        const current = await this.loadConfig().catch(() => ({ desktop: {} }))
        const next = _.merge({}, current, patch)
        await this.tequilapi.updateUserConfig({ data: next } as any)
        this.record("Configuration saved")
        this.sendJson(res, 200, { config: next })
    }

    private handleLogs = async (_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
        this.sendJson(res, 200, {
            events: this.events.slice(-80),
            file: await this.readLogFile(),
        })
    }

    private async readJson(req: http.IncomingMessage): Promise<JsonObject> {
        const chunks: Buffer[] = []
        let size = 0
        for await (const chunk of req) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
            size += buffer.length
            if (size > REQUEST_BODY_LIMIT_BYTES) {
                throw new Error("Request body is too large")
            }
            chunks.push(buffer)
        }
        if (chunks.length === 0) {
            return {}
        }
        return JSON.parse(Buffer.concat(chunks).toString("utf8"))
    }

    private async identitySnapshot(): Promise<JsonObject> {
        const identities = await this.tequilapi.identityList()
        let current
        if (identities.length > 0) {
            current = await this.currentIdentity().catch(() => undefined)
        }
        return { identities, current }
    }

    private async currentIdentity(): Promise<{ id: string; [key: string]: unknown }> {
        const ids = await this.tequilapi.identityList()
        if (ids.length < 1) {
            throw new Error("No identity exists yet")
        }
        const currentRef = await this.tequilapi.identityCurrent({ passphrase: "" }).catch(() => ids[0])
        return this.tequilapi.identity(currentRef.id)
    }

    private async connectToProvider(providerId: string, serviceType: string, dnsOverride = ""): Promise<void> {
        const identity = await this.currentIdentity()
        const config = await this.loadConfig().catch(() => ({ desktop: {} }))
        const dns = dnsOverride || String(_.get(config, ["desktop", "dns"]) || "provider")

        await this.tequilapi.identityUnlock(identity.id, "", 10_000).catch(() => undefined)
        await this.tequilapi.connectionCreate(
            {
                consumerId: identity.id,
                providerId,
                serviceType,
                connectOptions: {
                    dns,
                    disableKillSwitch: true,
                    proxyPort: LOCAL_PROXY_PORT,
                },
            } as any,
            60_000,
        )
    }

    private async loadConfig(): Promise<JsonObject> {
        const config = await this.tequilapi.userConfig()
        return _.merge({ desktop: {} }, config.data)
    }

    private async proposalPresets(): Promise<unknown[]> {
        const presets = await this.tequilapi.proposalFilterPresets()
        return presets.items
    }

    private async waitForNode(): Promise<void> {
        for (let attempt = 0; attempt < 30; attempt += 1) {
            if (await this.isNodeUp()) {
                return
            }
            await sleep(1_000)
        }
        throw new Error("Myst node did not become ready in time")
    }

    private async isNodeUp(): Promise<boolean> {
        try {
            await this.tequilapi.healthCheck(1_500)
            return true
        } catch (err) {
            return false
        }
    }

    private async optional<T>(fn: () => Promise<T>): Promise<OptionalResult<T>> {
        try {
            return { ok: true, data: await fn() }
        } catch (err) {
            const msg = parseError(err)
            return { ok: false, error: msg.humanReadable || msg.original }
        }
    }

    private downResult<T>(): OptionalResult<T> {
        return { ok: false, error: "Myst node is not running" }
    }

    private isAllowedHost(hostHeader?: string): boolean {
        if (!hostHeader) {
            return false
        }
        const host = hostHeader.split(":")[0].toLowerCase()
        return host === "127.0.0.1" || host === "localhost"
    }

    private sendJson(res: http.ServerResponse, statusCode: number, body: unknown): void {
        res.writeHead(statusCode, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        })
        res.end(JSON.stringify(body))
    }

    private sendError(res: http.ServerResponse, err: unknown): void {
        const msg = parseError(err)
        log.error("Web UI request failed", msg.original)
        this.sendJson(res, 500, { error: msg.humanReadable || msg.original })
    }

    private record(message: string): void {
        const line = `${new Date().toISOString()} ${message}`
        this.events.push(line)
        this.events = this.events.slice(-200)
        log.info(line)
    }

    private async readLogFile(): Promise<string[]> {
        const fileTransport = log.transports.file as any
        const filename = fileTransport?.getFile?.().path
        if (!filename) {
            return []
        }
        try {
            const stat = await fs.promises.stat(filename)
            const start = Math.max(0, stat.size - 128 * 1024)
            const handle = await fs.promises.open(filename, "r")
            try {
                const buffer = Buffer.alloc(stat.size - start)
                await handle.read(buffer, 0, buffer.length, start)
                return buffer.toString("utf8").split(/\r?\n/).filter(Boolean).slice(-200)
            } finally {
                await handle.close()
            }
        } catch (err) {
            return []
        }
    }
}

export const localWebServer = new LocalWebServer()

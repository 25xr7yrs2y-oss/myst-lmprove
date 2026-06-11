/**
 * Copyright (c) 2020 BlockDev AG
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import { app, Menu, shell, Tray } from "electron"

import * as packageJson from "../../package.json"
import { initialize as initializeSentry } from "../shared/errors/sentry"
import { log } from "../shared/log/log"
import { handleProcessExit } from "../utils/handleProcessExit"

import { cliFlags } from "./cliFlags"
import { mysteriumNode } from "./node/mysteriumNode"
import { localWebServer } from "./webServer"
import { createWebTray } from "./webTray"

initializeSentry()

// Keep a process-wide reference so Electron does not garbage collect the tray.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let tray: Tray | null = null
let appIsQuitting = false

const appInstanceLock = app.requestSingleInstanceLock()

const openWebUi = async (): Promise<void> => {
    await shell.openExternal(localWebServer.url)
}

const startLocalWebUi = async (): Promise<void> => {
    Menu.setApplicationMenu(null)
    await localWebServer.start()
    tray = createWebTray(app, localWebServer)

    try {
        await localWebServer.startNode()
    } catch (err) {
        log.warn("Could not auto-start Myst node. The web UI can still start it manually.", err)
    }

    log.info(`${packageJson.productName} is available at ${localWebServer.url}`)
    await openWebUi()
}

if (!appInstanceLock) {
    app.quit()
} else {
    app.on("second-instance", async () => {
        await openWebUi()
    })

    app.on("ready", async () => {
        await startLocalWebUi()
    })
}

app.whenReady().then(() => {
    app.on("activate", async () => {
        await openWebUi()
    })
})

app.on("before-quit", async () => {
    appIsQuitting = true
    tray?.destroy()
    tray = null
    await localWebServer.stop()
    await mysteriumNode.stop()
})

app.on("window-all-closed", () => {
    if (process.platform !== "darwin" || appIsQuitting) {
        app.quit()
    }
})

app.commandLine.appendSwitch(cliFlags.NO_UPDATE)

handleProcessExit()

export const ipcWebDisconnect = (): void => {
    localWebServer.stopNode().catch((err) => log.error("Could not disconnect from web IPC compatibility hook", err))
}

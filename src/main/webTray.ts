/**
 * Copyright (c) 2022 BlockDev AG
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import { App, Menu, shell, Tray } from "electron"

import * as packageJson from "../../package.json"
import { staticAssetPath } from "../utils/paths"

import { LocalWebServer } from "./webServer"

export const createWebTray = (app: App, webServer: LocalWebServer): Tray => {
    const tray = new Tray(staticAssetPath(process.platform === "win32" ? "tray/windows/logo.ico" : "logo.png"))
    tray.setToolTip(`${packageJson.productName} local web UI`)
    tray.setContextMenu(
        Menu.buildFromTemplate([
            {
                label: "Open Web UI",
                click: async (): Promise<void> => {
                    await shell.openExternal(webServer.url)
                },
            },
            {
                label: webServer.url,
                enabled: false,
            },
            {
                type: "separator",
            },
            {
                label: "Start local proxy node",
                click: async (): Promise<void> => {
                    await webServer.startNode()
                    await shell.openExternal(webServer.url)
                },
            },
            {
                label: "Stop local proxy node",
                click: async (): Promise<void> => {
                    await webServer.stopNode()
                },
            },
            {
                type: "separator",
            },
            {
                role: "quit",
                label: `Quit ${packageJson.productName}`,
                accelerator: "CommandOrControl+Q",
                click: (): void => {
                    app.quit()
                },
            },
        ]),
    )
    tray.on("double-click", async () => {
        await shell.openExternal(webServer.url)
    })
    return tray
}

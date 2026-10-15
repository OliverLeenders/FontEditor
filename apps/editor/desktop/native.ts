import { execFile } from "node:child_process";

import { APPLICATION } from "./harness.js";

/**
 * The application's windows as Windows has them, and the close button pressed.
 *
 * WebDriver can close a window, but it takes the webview away under the shell
 * and nothing is asked: the close the shell holds until the page has answered
 * is never raised. What the close button sends is a message to the window,
 * WM_CLOSE, and that is what is sent here — to the windows of the test build
 * and of nothing else, found by the program that made them.
 */

const WINDOWS = String.raw`
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class TypewrightWindows {
  delegate bool Each(IntPtr window, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumWindows(Each each, IntPtr data);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int most);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr w, IntPtr l);
  public static List<KeyValuePair<IntPtr, string>> Of(uint[] processes) {
    var found = new List<KeyValuePair<IntPtr, string>>();
    EnumWindows((window, data) => {
      uint process;
      GetWindowThreadProcessId(window, out process);
      if (IsWindowVisible(window) && Array.IndexOf(processes, process) >= 0) {
        var text = new StringBuilder(512);
        GetWindowText(window, text, 512);
        if (text.Length > 0) found.Add(new KeyValuePair<IntPtr, string>(window, text.ToString()));
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
$processes = @(Get-Process typewright -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $env:TW_APP } | ForEach-Object { [uint32]$_.Id })
foreach ($each in [TypewrightWindows]::Of($processes)) {
  if ($env:TW_CLOSE -ne "" -and $each.Value -eq $env:TW_CLOSE) {
    [void][TypewrightWindows]::PostMessage($each.Key, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
  }
  [Console]::Out.WriteLine($each.Value)
}
`;

async function run(close: string): Promise<string[]> {
  const script = Buffer.from(WINDOWS, "utf16le").toString("base64");
  const out = await new Promise<string>((done, fail) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", script],
      { env: { ...process.env, TW_APP: APPLICATION, TW_CLOSE: close } },
      (error, stdout, stderr) => {
        if (error) fail(new Error(`${error.message}\n${stderr}`));
        else done(stdout);
      },
    );
  });
  return out
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** The titles of the test build's windows on screen. */
export async function windowTitles(): Promise<string[]> {
  return await run("");
}

/** The close button of the window with this title, pressed. */
export async function pressClose(title: string): Promise<void> {
  const titles = await run(title);
  if (!titles.includes(title)) {
    throw new Error(`no window called ${title}: there are ${titles.join(", ") || "none"}`);
  }
}

/** Whether a window can be closed as its button closes it, here. */
export const NATIVE_CLOSE = process.platform === "win32";

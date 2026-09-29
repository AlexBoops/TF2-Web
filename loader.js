(() => {
    "use strict";

    // 1. Resolve CDN base correctly
    const DEFAULT_CDN = "https://cdn.jsdelivr.net/gh/AlexBoops/TF2-Web@main/";
    const BASE_URL = (typeof window !== "undefined" && window.CS_FILES_BASE) ? window.CS_FILES_BASE : DEFAULT_CDN;
    const CHUNK_DIR = BASE_URL.endsWith("/") ? BASE_URL + "chunks/" : BASE_URL + "/chunks/";

    const FILES = {
        "background01.data": 17,
        "common.data": 39,
        "cp_dustbowl.data": 27,
        "cp_granary.data": 24,
        "cp_gravelpit.data": 23,
        "cp_well.data": 29,
        "ctf_2fort.data": 27,
        "tc_hydro.data": 30
    };

    // Cache promises immediately to eliminate duplicate concurrent downloads
    const inflightPromises = new Map();
    const completedCache = new Map();

    function getFileName(url) {
        try {
            const u = new URL(url, location.href);
            return decodeURIComponent(u.pathname.split("/").pop());
        } catch {
            return url.split("/").pop().split("?")[0];
        }
    }

    function isSplitFile(url) {
        return Object.prototype.hasOwnProperty.call(FILES, getFileName(url));
    }

    // Helper: fetch with 10s timeout
    async function fetchWithTimeout(url, timeoutMs = 10000) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await originalFetch(url, { signal: controller.signal });
            clearTimeout(timer);
            return res;
        } catch (err) {
            clearTimeout(timer);
            throw err;
        }
    }

    // Fetch chunk with multi-mirror fallback (jsDelivr -> raw.githack -> upstream)
    async function fetchChunkPart(partName) {
        const mirrors = [
            CHUNK_DIR + partName,
            `https://raw.githack.com/AlexBoops/TF2-Web/main/chunks/${partName}`,
            `https://cdn.jsdelivr.net/gh/linkawaken1979-alt/TF2-Web@main/chunks/${partName}`,
            `https://raw.githack.com/linkawaken1979-alt/TF2-Web/main/chunks/${partName}`
        ];

        let lastErr = null;
        for (const url of mirrors) {
            try {
                const res = await fetchWithTimeout(url, 10000);
                if (res.ok) {
                    const buf = await res.arrayBuffer();
                    // Reject small git-lfs stubs or invalid empty responses
                    if (buf.byteLength > 500 || partName.includes("038")) {
                        return buf;
                    }
                }
            } catch (err) {
                lastErr = err;
            }
        }
        throw new Error(`Failed to load chunk ${partName} across all CDN mirrors (${lastErr ? lastErr.message : "Not Found"})`);
    }

    async function loadSplitFile(url) {
        const fileName = getFileName(url);

        // Return completed cache if already downloaded
        if (completedCache.has(fileName)) {
            return completedCache.get(fileName).slice(0);
        }

        // Return ongoing in-flight promise if another caller already started this file
        if (inflightPromises.has(fileName)) {
            const data = await inflightPromises.get(fileName);
            return data.slice(0);
        }

        const count = FILES[fileName];
        if (!count) {
            throw new Error("Unknown split file: " + fileName);
        }

        console.log(`[TF2 Loader] Assembling ${fileName} (${count} parts from CDN)...`);

        const assemblyPromise = (async () => {
            const parts = [];
            let totalSize = 0;

            for (let i = 0; i < count; i++) {
                const partName = fileName.replace(/\.data$/, "") + `.part${String(i).padStart(3, "0")}.data`;
                console.log(`[TF2 Loader] ${fileName}: ${i + 1}/${count} (${partName})`);

                const buffer = await fetchChunkPart(partName);
                parts.push(buffer);
                totalSize += buffer.byteLength;
            }

            console.log(`[TF2 Loader] ${fileName} fully assembled: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);

            const output = new Uint8Array(totalSize);
            let offset = 0;
            for (const part of parts) {
                output.set(new Uint8Array(part), offset);
                offset += part.byteLength;
            }

            completedCache.set(fileName, output);
            inflightPromises.delete(fileName);
            return output;
        })();

        inflightPromises.set(fileName, assemblyPromise);
        const result = await assemblyPromise;
        return result.slice(0);
    }

    // Save original fetch
    const originalFetch = window.fetch.bind(window);

    // Replace fetch
    window.fetch = async function(input, init) {
        const url =
            typeof input === "string"
                ? input
                : input instanceof Request
                    ? input.url
                    : String(input);

        if (!isSplitFile(url)) {
            return originalFetch(input, init);
        }

        console.log(`[TF2 Loader] Intercepted split request: ${getFileName(url)}`);
        const data = await loadSplitFile(url);

        return new Response(data, {
            status: 200,
            statusText: "OK",
            headers: {
                "Content-Type": "application/octet-stream",
                "Content-Length": String(data.byteLength)
            }
        });
    };

    // XHR support
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url, async = true, user, password) {
        this._tf2URL = url;
        this._tf2Split = isSplitFile(url);

        if (this._tf2Split) {
            this._tf2Method = method;
            this._tf2Async = async;
            return originalOpen.call(this, method, url, async, user, password);
        }

        return originalOpen.call(this, method, url, async, user, password);
    };

    XMLHttpRequest.prototype.send = function(body) {
        if (!this._tf2Split) {
            return originalSend.call(this, body);
        }

        const xhr = this;
        loadSplitFile(this._tf2URL)
            .then(data => {
                Object.defineProperty(xhr, "status", { configurable: true, value: 200 });
                Object.defineProperty(xhr, "statusText", { configurable: true, value: "OK" });
                Object.defineProperty(xhr, "response", { configurable: true, value: data.buffer });
                Object.defineProperty(xhr, "responseText", { configurable: true, value: new TextDecoder().decode(data) });
                Object.defineProperty(xhr, "readyState", { configurable: true, value: 4 });

                if (typeof xhr.onload === "function") xhr.onload(new ProgressEvent("load"));
                if (typeof xhr.onreadystatechange === "function") xhr.onreadystatechange(new Event("readystatechange"));
                if (typeof xhr.onloadend === "function") xhr.onloadend(new ProgressEvent("loadend"));
            })
            .catch(error => {
                console.error("[TF2 Loader]", error);
                if (typeof xhr.onerror === "function") xhr.onerror(new ProgressEvent("error"));
            });
    };

    console.log("[TF2 Loader] Multi-mirror resilient chunk loader initialized.");
})();

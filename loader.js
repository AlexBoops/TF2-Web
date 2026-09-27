(() => {
    "use strict";

    const CHUNK_DIR = "chunks/";
    const CHUNK_SIZE = 20 * 1024 * 1024;

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

    const cache = new Map();

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

    async function loadSplitFile(url) {
        const fileName = getFileName(url);

        if (cache.has(fileName)) {
            return cache.get(fileName).slice(0);
        }

        const count = FILES[fileName];

        if (!count) {
            throw new Error("Unknown split file: " + fileName);
        }

        console.log(`[TF2 Loader] Loading ${fileName} (${count} parts)`);

        const parts = [];
        let totalSize = 0;

        for (let i = 0; i < count; i++) {
            const partName =
                fileName.replace(/\.data$/, "") +
                `.part${String(i).padStart(3, "0")}.data`;

            const partURL = new URL(
                CHUNK_DIR + partName,
                new URL(url, location.href)
            ).href;

            console.log(
                `[TF2 Loader] ${fileName}: ${i + 1}/${count}`
            );

            const response = await originalFetch(partURL);

            if (!response.ok) {
                throw new Error(
                    `Failed to load ${partName}: HTTP ${response.status}`
                );
            }

            const buffer = await response.arrayBuffer();

            parts.push(buffer);
            totalSize += buffer.byteLength;
        }

        console.log(
            `[TF2 Loader] ${fileName} assembled: ` +
            `${(totalSize / 1024 / 1024).toFixed(2)} MB`
        );

        const output = new Uint8Array(totalSize);
        let offset = 0;

        for (const part of parts) {
            output.set(new Uint8Array(part), offset);
            offset += part.byteLength;
        }

        cache.set(fileName, output);

        return output.slice(0);
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

        console.log(`[TF2 Loader] Intercepted: ${getFileName(url)}`);

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

    XMLHttpRequest.prototype.open = function(
        method,
        url,
        async = true,
        user,
        password
    ) {
        this._tf2URL = url;
        this._tf2Split = isSplitFile(url);

        if (this._tf2Split) {
            this._tf2Method = method;
            this._tf2Async = async;
            return originalOpen.call(
                this,
                method,
                url,
                async,
                user,
                password
            );
        }

        return originalOpen.call(
            this,
            method,
            url,
            async,
            user,
            password
        );
    };

    XMLHttpRequest.prototype.send = function(body) {
        if (!this._tf2Split) {
            return originalSend.call(this, body);
        }

        const xhr = this;

        loadSplitFile(this._tf2URL)
            .then(data => {
                Object.defineProperty(xhr, "status", {
                    configurable: true,
                    value: 200
                });

                Object.defineProperty(xhr, "statusText", {
                    configurable: true,
                    value: "OK"
                });

                Object.defineProperty(xhr, "response", {
                    configurable: true,
                    value: data.buffer
                });

                Object.defineProperty(xhr, "responseText", {
                    configurable: true,
                    value: new TextDecoder().decode(data)
                });

                Object.defineProperty(xhr, "readyState", {
                    configurable: true,
                    value: 4
                });

                if (typeof xhr.onload === "function") {
                    xhr.onload(new ProgressEvent("load"));
                }

                if (typeof xhr.onreadystatechange === "function") {
                    xhr.onreadystatechange(new Event("readystatechange"));
                }

                if (typeof xhr.onloadend === "function") {
                    xhr.onloadend(new ProgressEvent("loadend"));
                }
            })
            .catch(error => {
                console.error("[TF2 Loader]", error);

                if (typeof xhr.onerror === "function") {
                    xhr.onerror(new ProgressEvent("error"));
                }
            });
    };

    console.log("[TF2 Loader] Split-data loader initialized.");
})();
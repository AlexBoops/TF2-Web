<script>
(() => {
    "use strict";

    const CHUNK_DIR =
        "https://raw.githubusercontent.com/linkawaken1979-alt/TF2-Web/main/chunks/";

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

    // ------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------

    function getFileName(url) {
        try {
            const u = new URL(url, location.href);
            return decodeURIComponent(
                u.pathname.split("/").pop()
            );
        } catch {
            return String(url)
                .split("/")
                .pop()
                .split("?")[0];
        }
    }

    function isSplitFile(url) {
        return Object.prototype.hasOwnProperty.call(
            FILES,
            getFileName(url)
        );
    }

    // ------------------------------------------------------------
    // Original fetch
    // ------------------------------------------------------------

    const originalFetch = window.fetch.bind(window);

    // ------------------------------------------------------------
    // Load split file from GitHub
    // ------------------------------------------------------------

    async function loadSplitFile(url) {
        const fileName = getFileName(url);

        if (cache.has(fileName)) {
            console.log(
                "[TF2 Loader] Cache hit:",
                fileName
            );

            return cache.get(fileName);
        }

        const count = FILES[fileName];

        if (!count) {
            throw new Error(
                "[TF2 Loader] Unknown split file: " +
                fileName
            );
        }

        console.log(
            `[TF2 Loader] Starting ${fileName} (${count} parts)`
        );

        const parts = [];
        let totalSize = 0;

        for (let i = 0; i < count; i++) {
            const partName =
                fileName.replace(/\.data$/, "") +
                `.part${String(i).padStart(3, "0")}.data`;

            const partURL =
                CHUNK_DIR +
                encodeURIComponent(partName);

            console.log(
                `[TF2 Loader] ${fileName}: ` +
                `${i + 1}/${count}`
            );

            const response = await originalFetch(
                partURL,
                {
                    cache: "force-cache"
                }
            );

            if (!response.ok) {
                throw new Error(
                    `[TF2 Loader] Failed ${partName}: ` +
                    `HTTP ${response.status}`
                );
            }

            const buffer =
                await response.arrayBuffer();

            parts.push(buffer);
            totalSize += buffer.byteLength;

            const percent =
                Math.round(
                    ((i + 1) / count) * 100
                );

            console.log(
                `[TF2 Loader] ${fileName}: ${percent}%`
            );
        }

        // Assemble one contiguous buffer.
        const output =
            new Uint8Array(totalSize);

        let offset = 0;

        for (const part of parts) {
            output.set(
                new Uint8Array(part),
                offset
            );

            offset += part.byteLength;
        }

        console.log(
            `[TF2 Loader] Finished ${fileName}: ` +
            `${(totalSize / 1024 / 1024).toFixed(2)} MB`
        );

        cache.set(fileName, output);

        return output;
    }

    // ------------------------------------------------------------
    // FETCH INTERCEPTION
    // ------------------------------------------------------------

    window.fetch = async function(input, init) {
        let url;

        if (typeof input === "string") {
            url = input;
        } else if (input instanceof Request) {
            url = input.url;
        } else {
            url = String(input);
        }

        if (!isSplitFile(url)) {
            return originalFetch(input, init);
        }

        const fileName = getFileName(url);

        console.log(
            "[TF2 Loader] Intercepted fetch:",
            fileName
        );

        const data =
            await loadSplitFile(url);

        return new Response(data.slice(0), {
            status: 200,
            statusText: "OK",
            headers: {
                "Content-Type":
                    "application/octet-stream"
            }
        });
    };

    // ------------------------------------------------------------
    // XHR INTERCEPTION
    //
    // Instead of faking XHR properties, assemble the file into
    // a Blob URL and let the browser's real XHR implementation
    // handle the response.
    // ------------------------------------------------------------

    const NativeXHR =
        window.XMLHttpRequest;

    const nativeOpen =
        NativeXHR.prototype.open;

    const nativeSend =
        NativeXHR.prototype.send;

    NativeXHR.prototype.open =
        function(method, url, async, user, password) {

            this._tf2Method = method;
            this._tf2URL = String(url);
            this._tf2Async =
                async === undefined ? true : async;
            this._tf2User = user;
            this._tf2Password = password;

            this._tf2Split =
                isSplitFile(this._tf2URL);

            if (this._tf2Split) {
                console.log(
                    "[TF2 Loader] Intercepted XHR:",
                    getFileName(this._tf2URL)
                );

                // Don't open the original .data URL yet.
                return;
            }

            return nativeOpen.call(
                this,
                method,
                url,
                async,
                user,
                password
            );
        };

    NativeXHR.prototype.send =
        function(body) {

            if (!this._tf2Split) {
                return nativeSend.call(
                    this,
                    body
                );
            }

            const xhr = this;
            const originalURL = this._tf2URL;

            loadSplitFile(originalURL)
                .then(data => {

                    const blob =
                        new Blob(
                            [data],
                            {
                                type:
                                    "application/octet-stream"
                            }
                        );

                    const blobURL =
                        URL.createObjectURL(blob);

                    xhr._tf2BlobURL =
                        blobURL;

                    // Open the REAL XHR against
                    // the assembled blob.
                    nativeOpen.call(
                        xhr,
                        xhr._tf2Method,
                        blobURL,
                        xhr._tf2Async,
                        xhr._tf2User,
                        xhr._tf2Password
                    );

                    // Clean up after XHR finishes.
                    const oldLoadEnd =
                        xhr.onloadend;

                    xhr.onloadend =
                        function(event) {

                            URL.revokeObjectURL(
                                blobURL
                            );

                            if (
                                typeof oldLoadEnd ===
                                "function"
                            ) {
                                oldLoadEnd.call(
                                    xhr,
                                    event
                                );
                            }
                        };

                    nativeSend.call(
                        xhr,
                        body
                    );
                })
                .catch(error => {
                    console.error(
                        "[TF2 Loader] XHR error:",
                        error
                    );

                    // Trigger the normal XHR
                    // error callback.
                    if (
                        typeof xhr.onerror ===
                        "function"
                    ) {
                        xhr.onerror(
                            new ProgressEvent("error")
                        );
                    }

                    if (
                        typeof xhr.onloadend ===
                        "function"
                    ) {
                        xhr.onloadend(
                            new ProgressEvent(
                                "loadend"
                            )
                        );
                    }
                });
        };

    console.log(
        "[TF2 Loader] Single-file TF2 loader initialized."
    );

    console.log(
        "[TF2 Loader] Remote chunks:",
        CHUNK_DIR
    );

})();
</script>

<script async src="https://raw.githubusercontent.com/linkawaken1979-alt/TF2-Web/main/tf2_launcher.js"></script>

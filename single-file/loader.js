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

    const originalFetch = window.fetch.bind(window);
    const cache = new Map();

    function getFileName(url) {
        try {
            const clean = String(url).split("?")[0].split("#")[0];
            return decodeURIComponent(
                clean.substring(clean.lastIndexOf("/") + 1)
            );
        } catch {
            return String(url).split("/").pop();
        }
    }

    function findSplitFile(url) {
        const name = getFileName(url);

        if (FILES[name]) {
            return name;
        }

        for (const file of Object.keys(FILES)) {
            if (String(url).includes(file)) {
                return file;
            }
        }

        return null;
    }

    async function loadSplitFile(fileName) {

        if (cache.has(fileName)) {
            console.log(
                "[TF2 Loader] Using cached:",
                fileName
            );

            return cache.get(fileName);
        }

        const partCount = FILES[fileName];

        console.log(
            `[TF2 Loader] START ${fileName} — ${partCount} parts`
        );

        const parts = [];
        let totalSize = 0;

        for (let i = 0; i < partCount; i++) {

            const partName =
                fileName.replace(".data", "") +
                ".part" +
                String(i).padStart(3, "0") +
                ".data";

            const partURL =
                CHUNK_DIR + partName;

            console.log(
                `[TF2 Loader] GET ${i + 1}/${partCount}: ${partName}`
            );

            const response =
                await originalFetch(
                    partURL,
                    {
                        cache: "no-store"
                    }
                );

            if (!response.ok) {
                throw new Error(
                    `HTTP ${response.status} while loading ${partURL}`
                );
            }

            const buffer =
                await response.arrayBuffer();

            console.log(
                `[TF2 Loader] OK ${partName} — ` +
                `${(buffer.byteLength / 1048576).toFixed(2)} MB`
            );

            parts.push(buffer);
            totalSize += buffer.byteLength;

            if (window.Module) {
                Module.setStatus =
                    Module.setStatus || (() => {});

                try {
                    Module.setStatus(
                        `Loading ${fileName} (${i + 1}/${partCount})`
                    );
                } catch {}
            }
        }

        console.log(
            `[TF2 Loader] Combining ${fileName}: ` +
            `${(totalSize / 1048576).toFixed(2)} MB`
        );

        const combined =
            new Uint8Array(totalSize);

        let offset = 0;

        for (const buffer of parts) {

            combined.set(
                new Uint8Array(buffer),
                offset
            );

            offset += buffer.byteLength;
        }

        cache.set(
            fileName,
            combined
        );

        console.log(
            `[TF2 Loader] COMPLETE ${fileName}`
        );

        return combined;
    }

    /*
     * FETCH INTERCEPTOR
     */

    window.fetch = async function(input, init) {

        const url =
            input instanceof Request
                ? input.url
                : String(input);

        const fileName =
            findSplitFile(url);

        if (!fileName) {
            return originalFetch(
                input,
                init
            );
        }

        console.log(
            "[TF2 Loader] FETCH INTERCEPTED:",
            url
        );

        const data =
            await loadSplitFile(fileName);

        return new Response(
            data.slice(0),
            {
                status: 200,
                statusText: "OK",
                headers: {
                    "Content-Type":
                        "application/octet-stream",
                    "Content-Length":
                        String(data.byteLength)
                }
            }
        );
    };

    /*
     * XHR INTERCEPTOR
     */

    const NativeXHR =
        window.XMLHttpRequest;

    const nativeOpen =
        NativeXHR.prototype.open;

    const nativeSend =
        NativeXHR.prototype.send;

    NativeXHR.prototype.open =
        function(
            method,
            url,
            async,
            user,
            password
        ) {

            const fileName =
                findSplitFile(url);

            if (!fileName) {
                return nativeOpen.call(
                    this,
                    method,
                    url,
                    async,
                    user,
                    password
                );
            }

            console.log(
                "[TF2 Loader] XHR INTERCEPTED:",
                url
            );

            this.__tf2Split = true;
            this.__tf2File = fileName;
            this.__tf2Method = method;
            this.__tf2Async =
                async === undefined
                    ? true
                    : async;

            this.__tf2User = user;
            this.__tf2Password = password;
            this.__tf2URL = String(url);
        };

    NativeXHR.prototype.send =
        function(body) {

            if (!this.__tf2Split) {
                return nativeSend.call(
                    this,
                    body
                );
            }

            const xhr = this;

            loadSplitFile(
                this.__tf2File
            )
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
                    URL.createObjectURL(
                        blob
                    );

                nativeOpen.call(
                    xhr,
                    xhr.__tf2Method,
                    blobURL,
                    xhr.__tf2Async,
                    xhr.__tf2User,
                    xhr.__tf2Password
                );

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
                    "[TF2 Loader] XHR FAILED:",
                    error
                );

                if (
                    typeof xhr.onerror ===
                    "function"
                ) {
                    xhr.onerror(
                        new ErrorEvent(
                            "error",
                            {
                                error
                            }
                        )
                    );
                }
            });
        };

    console.log(
        "[TF2 Loader] Inline split-data loader initialized."
    );

    console.log(
        "[TF2 Loader] Chunk source:",
        CHUNK_DIR
    );

})();
</script>

<script async src="https://raw.githubusercontent.com/linkawaken1979-alt/TF2-Web/main/tf2_launcher.js"></script>

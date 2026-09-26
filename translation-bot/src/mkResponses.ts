export function mkSuccess() {
    return {
        status: 210,
        statusText: "SUCCESS",
        headers: {
            "X-Status-Text": "SUCCESS"
        }
    }
}

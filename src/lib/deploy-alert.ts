/** Record production version drift without sending an operations message to LINE. */
export function recordDeployMismatch(params: { mainSha: string; prodSha: string }): void {
  console.error("[deploy-health] production version mismatch", {
    main: params.mainSha.slice(0, 7),
    prod: params.prodSha.slice(0, 7),
  });
}

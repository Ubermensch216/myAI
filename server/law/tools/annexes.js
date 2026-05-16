import { runLoggedLawTool } from "./toolRunner.js";

export async function searchAnnexes(input = {}, options = {}) {
  return runLoggedLawTool({
    tool: "search_annexes",
    options,
    normalizedQuery: {
      query: input.query,
      display: input.display,
      lawName: input.lawName || "",
      annexId: input.annexId || "",
      annexNo: input.annexNo || "",
      annexTitle: input.annexTitle || "",
      formNo: input.formNo || "",
      annexType: input.annexType || ""
    },
    execute: (client) => client.searchAnnexes(input, options)
  });
}

export async function getAnnexDetail(input = {}, options = {}) {
  return runLoggedLawTool({
    tool: "annex_detail",
    options,
    normalizedQuery: {
      mst: input.mst || "",
      lawName: input.lawName || "",
      annexId: input.annexId || "",
      annexNo: input.annexNo || "",
      annexTitle: input.annexTitle || "",
      formNo: input.formNo || "",
      annexType: input.annexType || ""
    },
    execute: (client) => client.getAnnexDetail(input, options)
  });
}

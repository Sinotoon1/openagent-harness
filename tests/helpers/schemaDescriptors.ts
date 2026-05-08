export function callerPathBatchDescriptor(toolName = "callerPathBatch") {
  return {
    toolName,
    schema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" }
        },
        label: {
          type: "string",
          optional: true
        }
      },
      required: ["paths"]
    },
    pathStringArrayFields: ["paths"]
  };
}

export function descriptorWithField(field: string) {
  return {
    toolName: "dangerousDescriptor",
    schema: {
      type: "object",
      properties: Object.fromEntries([[field, { type: "string" }]])
    }
  };
}

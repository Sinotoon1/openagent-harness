type IssuePathSegment = string | number | symbol;

export interface IssueLike {
  code: string;
  message: string;
  path: readonly IssuePathSegment[];
}

export interface SummarizedIssue {
  code: string;
  path: string;
  message: string;
}

export interface StandardInvalidToolResponse {
  valid: false;
  modelMessage: string;
  issues: SummarizedIssue[];
  error: {
    code: "tool_input_invalid";
    toolName: string;
    modelMessage: string;
    issues: SummarizedIssue[];
    expectedShape: string;
  };
}

export function makeInvalidToolResponse(options: {
  toolName: string;
  issues: readonly IssueLike[];
  expectedShape: string;
}): StandardInvalidToolResponse {
  const issues = options.issues.map(summarizeIssue);
  const modelMessage = buildInvalidModelMessage({
    toolName: options.toolName,
    invalidFields: uniqueInvalidFields(issues),
    expectedShape: options.expectedShape
  });

  return {
    valid: false,
    modelMessage,
    issues,
    error: {
      code: "tool_input_invalid",
      toolName: options.toolName,
      modelMessage,
      issues,
      expectedShape: options.expectedShape
    }
  };
}

export function summarizeIssue(issue: IssueLike): SummarizedIssue {
  return {
    code: issue.code,
    path: pathToString(issue.path),
    message: issue.message
  };
}

export function pathToString(path: readonly IssuePathSegment[]): string {
  if (path.length === 0) {
    return "(root)";
  }

  return path.reduce<string>((output, segment) => {
    if (typeof segment === "number") {
      return `${output}[${segment}]`;
    }

    const text = String(segment);
    return output ? `${output}.${text}` : text;
  }, "");
}

function buildInvalidModelMessage(options: {
  toolName: string;
  invalidFields: string[];
  expectedShape: string;
}): string {
  const invalidFields = options.invalidFields.join(", ") || "(root input)";
  return `Tool ${options.toolName} input is invalid. Invalid fields: ${invalidFields}. Expected shape: ${options.expectedShape}. Retry this tool call with those fields corrected and preserve valid fields unchanged.`;
}

function uniqueInvalidFields(issues: readonly SummarizedIssue[]): string[] {
  return [...new Set(issues.map((issue) => issue.path))];
}

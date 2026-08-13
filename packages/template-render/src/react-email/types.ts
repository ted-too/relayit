export type ReactEmailRenderProps = Record<string, unknown>;

export interface ReactEmailRendered {
  html: string;
  /** Props actually used for the render (PreviewProps merged under caller props). */
  props: ReactEmailRenderProps;
  subject: string;
  text?: string;
}

export interface ReactEmailRenderError {
  code:
    | "render_failed"
    | "missing_default_export"
    | "missing_subject"
    | "timeout"
    | "invalid_artifact";
  message: string;
}

export type ReactEmailRenderResult =
  | { ok: true; value: ReactEmailRendered }
  | { ok: false; error: ReactEmailRenderError };

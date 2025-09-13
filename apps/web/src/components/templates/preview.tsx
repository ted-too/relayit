import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTRPC } from "@/integrations/trpc/react";

interface EmailPreviewProps {
  template: {
    engine: "react-email";
    subject: string;
    component: string;
  };
  previewData: Record<string, any>;
  className?: string;
}

export function EmailPreview({
  template,
  previewData,
  className,
}: EmailPreviewProps) {
  const trpc = useTRPC();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeHeight, setIframeHeight] = useState(400); // Default height

  const {
    mutate: previewTemplate,
    data: renderResult,
    error,
    isPending: isLoading,
  } = useMutation(trpc.templates.preview.mutationOptions());

  useEffect(() => {
    console.log("previewing template");
    previewTemplate({
      template: {
        channel: "email",
        content: template,
      },
      props: previewData,
    });
  }, [previewData, template, previewTemplate]);

  // Auto-resize iframe to content height
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!(iframe && renderResult)) return;

    const resizeIframe = () => {
      try {
        const iframeDoc =
          iframe.contentDocument || iframe.contentWindow?.document;
        if (iframeDoc) {
          const body = iframeDoc.body;
          const html = iframeDoc.documentElement;

          // Get the actual content height
          const height = Math.max(
            body.scrollHeight,
            body.offsetHeight,
            html.clientHeight,
            html.scrollHeight,
            html.offsetHeight
          );

          // Add some padding and set minimum height
          const newHeight = Math.max(height + 20, 200);
          setIframeHeight(newHeight);
        }
      } catch (error) {
        // Cross-origin or other errors - keep default height
        console.warn("Could not resize iframe:", error);
      }
    };

    // Resize when iframe loads
    iframe.onload = resizeIframe;

    // Also try to resize immediately in case content is already loaded
    resizeIframe();
  }, [renderResult]);

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-blue-500 border-b-2" />
          <p className="text-gray-600 text-sm">Rendering email preview...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-medium text-red-800">Rendering Error</h3>
          <button
            type="button"
            onClick={() => {
              previewTemplate({
                template: {
                  channel: "email",
                  content: template,
                },
                props: previewData,
              });
            }}
            className="rounded border border-red-300 bg-red-100 px-3 py-1 text-red-800 text-sm transition-colors hover:bg-red-200"
          >
            Retry
          </button>
        </div>
        <pre className="whitespace-pre-wrap text-red-700 text-sm">
          {error.message}
        </pre>
      </div>
    );
  }

  if (!renderResult) {
    return (
      <div className="p-8 text-center text-gray-500">
        Enter template code to see preview
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Subject Preview */}
      <div className="border-b pb-4">
        <div className="font-medium text-gray-700 text-sm">Subject:</div>
        <p className="mt-1 font-medium">{renderResult.subject}</p>
      </div>

      {/* HTML Preview */}
      <div>
        <div className="mb-2 block font-medium text-gray-700 text-sm">
          Email Preview:
        </div>
        <div className="overflow-hidden rounded-lg border">
          <iframe
            ref={iframeRef}
            srcDoc={renderResult.html}
            className="w-full border-0"
            style={{ height: `${iframeHeight}px` }}
            title="Email Preview"
            sandbox="allow-same-origin"
          />
        </div>
      </div>

      {/* Text Preview (Collapsible) */}
      <details className="rounded-lg border">
        <summary className="cursor-pointer bg-gray-50 p-3 font-medium transition-colors hover:bg-gray-100">
          Plain Text Version
        </summary>
        <pre className="whitespace-pre-wrap border-t bg-white p-4 text-sm">
          {renderResult.text}
        </pre>
      </details>
    </div>
  );
}

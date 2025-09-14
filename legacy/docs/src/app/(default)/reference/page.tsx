"use client";

import { ApiReferenceReact } from "@scalar/api-reference-react";

import "@scalar/api-reference-react/style.css";

const config = {
  url: `${process.env.NEXT_PUBLIC_API_URL}/openapi`,
};

export default function ReferencePage() {
  return <ApiReferenceReact configuration={config} />;
}

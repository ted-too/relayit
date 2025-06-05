import {
	dynamic,
	dynamicParams,
	BasePage,
	internalGenerateMetadata,
	internalGenerateStaticParams,
	revalidate,
} from "@/app/(default)/(mdx)/base-page";

const generateMetadata = internalGenerateMetadata({ baseUrl: "legal" });
const generateStaticParams = internalGenerateStaticParams({ baseUrl: "legal" });

export {
	dynamic,
	dynamicParams,
	generateMetadata,
	generateStaticParams,
	revalidate,
};

export default BasePage({ baseUrl: "legal" });

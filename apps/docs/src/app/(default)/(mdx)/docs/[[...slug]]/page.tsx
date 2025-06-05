import {
	dynamic,
	dynamicParams,
	BasePage,
	internalGenerateMetadata,
	internalGenerateStaticParams,
	revalidate,
} from "@/app/(default)/(mdx)/base-page";

const generateMetadata = internalGenerateMetadata({ baseUrl: "docs" });
const generateStaticParams = internalGenerateStaticParams({ baseUrl: "docs" });

export {
	dynamic,
	dynamicParams,
	generateMetadata,
	generateStaticParams,
	revalidate,
};

export default BasePage({ baseUrl: "docs" });

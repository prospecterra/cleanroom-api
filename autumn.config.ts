import {
	feature,
	product,
	featureItem,
	priceItem,
} from "atmn";

// Features
export const apiCredits = feature({
	id: "api_credits",
	name: "API Credits",
	type: "single_use",
});

// Products
export const starter = product({
	id: "starter",
	name: "Starter",
	description: "$99/month - 100 API credits included",
	items: [
		priceItem({
			price: 99, // $99.00 (Autumn uses dollars, not cents)
			interval: "month",
		}),
		featureItem({
			feature_id: apiCredits.id,
			included_usage: 100,
			interval: "month",
			reset_usage_when_enabled: true,
		}),
	],
});

const Path = require("path");
const TerserPlugin = require("terser-webpack-plugin");
const CleanPlugin = require("clean-webpack-plugin").CleanWebpackPlugin;
const CopyPlugin = require("copy-webpack-plugin");
const NodeExternals = require("webpack-node-externals");

const prod = process.argv.indexOf("production") !== -1;

module.exports = {
	entry: "./src/index.ts",
	mode: prod ? "production" : "development",
	devtool: prod ? undefined : "source-map",
	plugins: prod
		? [
				new CleanPlugin(),
				new CopyPlugin({
					patterns: [
						"package.json",
						"package-lock.json",
						".env",
						{ from: "prisma/schema.prisma", to: "prisma" },
						{ from: "data/dummy.db", to: "data" },
						{ from: "data/tenants.json", to: "data" }
					]
				})
		  ]
		: [new CleanPlugin()],
	module: {
		rules: [
			{
				test: /service\.ts$/,
				use: [
					{
						loader: "./env/service.loader.js"
					},
					{
						loader: "comlink-loader",
						options: {
							singleton: true
						}
					}
				],
				include: Path.resolve(__dirname, "../src"),
				exclude: /node_modules/
			},
			{
				test: /\.ts$/,
				use: [
					{
						loader: "ts-loader",
						options: {
							compiler: "ttypescript",
							experimentalWatchApi: true
						}
					}
				],
				include: Path.resolve(__dirname, "../src"),
				exclude: /node_modules/
			}
		]
	},
	externals: [NodeExternals({ allowlist: [/^comlink/] })],
	resolve: {
		extensions: [".ts", ".js"]
	},
	output: {
		filename: "bundle.js",
		path: Path.resolve(__dirname, "../dist"),
		devtoolModuleFilenameTemplate: "[absolute-resource-path]"
	},
	optimization: {
		concatenateModules: false,
		minimize: prod ? true : false,
		minimizer: prod
			? [
					new TerserPlugin({
						terserOptions: {
							mangle: true,
							sourceMap: false,
							keep_classnames: true
						},
						extractComments: false
					})
			  ]
			: []
	},
	target: "node"
};

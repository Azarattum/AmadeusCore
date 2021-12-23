import { log, wrn, err } from "../../../common/utils.class";
import { first } from "../../models/generator";
import Endpoint from "./endpoint.abstract";
import Tenant from "../../models/tenant";
import { Server } from "http";
import express, {
	ErrorRequestHandler,
	Express,
	RequestHandler,
	Router
} from "express";

export default class API extends Endpoint {
	private static app: Express = express();
	private static connection?: Server;
	private static port = 8003;
	private static base = "/api/v1/";

	public initialize() {
		API.app.use(API.cors);
		API.app.use(API.auth);
		API.app.use(this.routes);
		API.app.use(API.error);
		if (!API.connection) {
			API.connection = API.app.listen(API.port, () => {
				log(`Listening on port ${API.port}`);
			});
		}
	}

	public close(): void {
		API.connection?.close();
		API.connection = undefined;
	}

	private static get error(): ErrorRequestHandler {
		return (e, req, res, next) => {
			if (Number.isInteger(+e)) {
				res.status(+e).end();
				wrn(`Request to ${req.url} failed with ${e}!`);
				return;
			}
			if (e instanceof Error) {
				err(`API error caught: "${e.message}"!\n${e.stack}`);
			} else err(`API unknown error: "${e.toString()}"!`);
			res.end();
		};
	}

	private static get auth(): RequestHandler {
		const handler: RequestHandler = (req, res, next) => {
			const identiefier = req.path.replace(API.base, "").split("/")[0];
			if (!identiefier) return next((res.statusCode = 404));
			const token = req.headers.authorization;
			if (!token) return next((res.statusCode = 401));
			const tenant = Tenant.fromCredentials(identiefier, token);
			if (!tenant) return next((res.statusCode = 403));
			return next();
		};

		return handler;
	}

	private static get cors(): RequestHandler {
		const handler: RequestHandler = (req, res, next) => {
			res.header("Access-Control-Allow-Origin", "*");
			res.header(
				"Access-Control-Allow-Headers",
				"Origin, X-Requested-With, Content-Type, Accept, Authorization"
			);

			if (req.method === "OPTIONS") {
				res.status(200);
				res.end();
				return;
			}

			next();
		};

		return handler;
	}

	private get routes(): Router {
		const router = Router({});
		const base = API.base + this.tenant.identifier;

		const asyncRoute: (f: RequestHandler) => RequestHandler =
			f => (req, res, next) => {
				return Promise.resolve(f(req, res, next)).catch(next);
			};
		const get = (path: string, handler: RequestHandler) =>
			router.get(path, asyncRoute(handler));

		get(base + "/verify", async (req, res) => {
			res.send(200);
		});

		get(base + "/playlist", async (req, res) => {
			const playlists = await this.want("playlists");
			res.send(playlists);
		});

		get(base + "/playlist/:id", async (req, res) => {
			const id = +req.params.id;
			if (!Number.isInteger(id)) return res.send(400);
			const tracks = await this.want("tracks", id);
			res.send(tracks);
		});

		get(base + "/added/", async (req, res) => {
			const tracks = await this.want("tracks");
			res.send(tracks);
		});

		get(base + "/track/*", async (req, res) => {
			const query = req.params[0];
			const tracks = await this.want("query", query, "source");
			const track = await first(tracks);
			if (!track) return res.send(404);
			res.send((await track.track()).url);
		});

		get(base + "/lyrics/*", async (req, res) => {
			const query = req.params[0];
			const lyrics = await this.want("lyrics", query);
			if (!lyrics) return res.send(404);
			res.send(lyrics);
		});

		return router;
	}
}

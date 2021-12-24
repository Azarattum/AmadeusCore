import { log, wrn, err } from "../../../common/utils.class";
import { first } from "../../models/generator";
import Endpoint from "./endpoint.abstract";
import Tenant from "../../models/tenant";
import compression from "compression";
import { readFileSync, existsSync } from "fs";
import { Server } from "http";
import https from "https";
import express, {
  ErrorRequestHandler,
  Express,
  RequestHandler,
  Router,
} from "express";

export default class API extends Endpoint {
  private static app: Express = express();
  private static https?: https.Server;
  private static connection?: Server;
  private static httpPort = 8003;
  private static httpsPort = 9003;
  private static base = "/api/v1/";

  public initialize() {
    API.app.use(compression());
    API.app.use(API.cors);
    API.app.use(API.auth);
    API.app.use(this.routes);
    API.app.use(API.error);
    if (!API.connection) {
      API.connection = API.app.listen(API.httpPort, () => {
        log(`API is listening on port ${API.httpPort}.`);
      });

      if (existsSync("privkey.pem") && existsSync("fullchain.pem")) {
        const options = {
          cert: readFileSync("./sslcert/fullchain.pem"),
          key: readFileSync("./sslcert/privkey.pem"),
        };
        API.https = https
          .createServer(options, API.app)
          .listen(API.httpsPort, () => {
            log(`Enabled HTTPS on port ${API.httpsPort}.`);
          });
      }
    }
  }

  public close(): void {
    API.connection?.close();
    API.connection = undefined;
    API.https?.close();
    API.https = undefined;
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
      (f) => (req, res, next) => {
        return Promise.resolve(f(req, res, next)).catch(next);
      };
    const get = (path: string, handler: RequestHandler) =>
      router.get(path, asyncRoute(handler));

    get(base + "/verify", async (req, res) => {
      res.sendStatus(200);
    });

    get(base + "/playlist", async (req, res) => {
      const playlists = await this.want("playlists");
      res.send(playlists);
    });

    get(base + "/playlist/added", async (req, res) => {
      const tracks = await this.want("tracks");
      res.send(tracks);
    });

    get(base + "/playlist/listened", async (req, res) => {
      res.send([]);
    });

    get(base + "/playlist/:id", async (req, res) => {
      const id = +req.params.id;
      if (!Number.isInteger(id)) return res.sendStatus(400);
      const tracks = await this.want("tracks", id);
      res.send(tracks);
    });

    get(base + "/track/*", async (req, res) => {
      const query = req.params[0];
      const tracks = await this.want("query", query, "source");
      const track = await first(tracks);
      if (!track) return res.sendStatus(404);
      res.send((await track.track()).url);
    });

    get(base + "/lyrics/*", async (req, res) => {
      const query = req.params[0];
      const lyrics = await this.want("lyrics", query);
      if (!lyrics) return res.sendStatus(404);
      res.send(lyrics);
    });

    return router;
  }
}

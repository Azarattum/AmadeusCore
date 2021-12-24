/* eslint-disable @typescript-eslint/no-unused-vars */
import * as nf from "node-fetch";
/** Custom typings */

declare global {
  function fetch(
    url: nf.RequestInfo,
    init?: nf.RequestInit
  ): Promise<nf.Response>;

  type RequestInfo = nf.RequestInfo;
  type RequestInit = nf.RequestInit;
  type Response = nf.Response;
  type Request = nf.Request;
  type BodyInit = nf.BodyInit;

  type func = (...args: any[]) => any;
  type obj = Record<any, any>;
}

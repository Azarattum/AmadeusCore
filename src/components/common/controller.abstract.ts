/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
/* eslint @typescript-eslint/explicit-function-return-type: 0 */
import {
  EventBind,
  EventBase,
  Component,
  ComponentOptions,
  EventCall,
  EventResult,
} from "./component.interface";
import Exposer from "./exposer.class";
import Utils from "./utils.class";

/**
 * Event-driven controller generic type builder
 */
export default function Controller<
  T extends EventBase = never,
  U extends EventBase = never
>() {
  /**
   * Abstract of the controller class
   */
  abstract class Controller implements Component {
    /**Component type */
    public static type: string = "Controllers";
    /**Controller universal unique id */
    public readonly uuid: string;
    /**Controller name */
    public readonly name: string;
    /**Callbacks storage */
    private callbacks: { [type: string]: func[] } = {};
    /**Callbacks storage */
    private wishes: { [type: string]: func } = {};
    /**Exposer object */
    private exposer?: Exposer;
    /**Relation reference */
    private relation: obj | null;

    /**
     * Creates controller class
     */
    public constructor({ exposer, relation }: ComponentOptions = {}) {
      this.uuid = Utils.generateID();
      this.name = this.constructor.name;
      this.exposer = exposer;
      this.relation = relation || null;
    }

    /**
     * No relations
     */
    public static get relations(): obj[] | null {
      return null;
    }

    /**
     * Closes the controller
     */
    public close(): void {
      //Close the controller
      this.callbacks = {};
      this.exposer?.close(this.name.toLowerCase(), this.relation);
    }

    /**
     * Listens to a specified event in the controller
     * @param type Event type
     * @param callback Callback function
     */
    public on(...[type, callback]: EventBind<T>): void {
      if (!(type in this.callbacks)) this.callbacks[type] = [];
      this.callbacks[type].push(callback);
    }

    /**
     * Defines an executor for a controller's wish
     * @param what Wish name
     * @param callback Executor function
     */
    public wants(...[what, callback]: EventBind<U>): void {
      this.wishes[what] = callback;
    }

    /**
     * Calls all the registered event listeners in the controller
     * @param type Event type
     * @param args Arguments to pass to the callbacks
     */
    protected async emit(...[type, ...args]: EventCall<T>): Promise<boolean> {
      const callbacks = this.callbacks[type];
      await Promise.all(callbacks?.map((x) => x(...args)));

      return callbacks && callbacks.length > 0;
    }

    /**
     * Calls the wish executor and returns its result.
     * Throws if an executor is not implemented!
     * @param type Executor type
     * @param args Arguments to pass to the executor
     */
    protected want<W extends EventCall<U>>(
      ...[type, ...args]: W
    ): EventResult<W, U> {
      const wish = this.wishes[type];
      if (!wish) {
        throw new Error("Wish cannot be fullfiled! Executor not implemented!");
      }

      return wish(...args);
    }

    /**
     * Exposes function to be used in global window scope.
     * Either a custom function can be provided or a method
     * of current service class (the names must match)
     * @param name Name of the exposed function (in the scope of service)
     * @param func Exposed function
     */
    protected expose(name: string, func: func | null = null): void {
      const exposed = func || ((this as any)[name] as func).bind(this);

      this.exposer?.expose(
        this.name.toLowerCase(),
        name,
        exposed,
        this.relation
      );
    }
  }

  //Return controller with specific typings
  return Controller;
}

import Exposer from "./exposer.class";

/**
 * Component interface
 */
export interface Component {
  /**Initializable name */
  name: string;

  /**Initializable entry */
  initialize?(...args: any[]): void;

  /**Component destructor */
  close?(): void;
}

/**
 * Component type interface
 */
export interface ComponentType<T extends Component = Component> {
  /**Component type */
  type: string;

  /**Component constructor */
  new (options: ComponentOptions): T;

  /**Component relations */
  relations: obj[] | null;
}

/**
 * Component's constructor options interface
 */
export interface ComponentOptions {
  /**Exposer object to use within component */
  exposer?: Exposer;

  /**Component's relation */
  relation?: obj | null;

  /**Application refresh callback */
  refresh?: () => void;
}

/**
 * Bindable event with name
 */
export type EventBase = [string, func] | string;
/**
 * Bind event params
 */
export type EventBind<T extends EventBase> = T extends string ? [T, func] : T;
/**
 * Call event params
 */
export type EventCall<T extends EventBase> = T extends string
  ? [T, ...Parameters<func>]
  : [T[0], ...Parameters<T[1] extends func ? T[1] : any>];
/**
 * Resulting type of the event's callback
 */
export type EventResult<
  T extends EventCall<U>,
  U extends EventBase
> = ReturnType<Extract<U, { 0: T[0] }>[1]>;

/**
 * Exposes function with `this.expose()` of current component.
 * The default name (macthes method's name) is used when `@expose`, `@expose()`.
 * Custom name can be specified with `@expose("<name>")`
 * @param name Custom name for an exposed function
 */
export function expose(...args: any[]): any {
  let name: string = "";
  const decorator = function (
    target: Component & { expose: (name: string, func: func) => void },
    key: string,
    descriptor: PropertyDescriptor
  ): void {
    name = name || key;
    const original = target.initialize;
    target.initialize = function (...args: any[]): any {
      const func = descriptor.value?.bind(this);
      if (func) this.expose?.(name, func);

      return original?.bind(this)?.(...args);
    };
  };

  if (args.length == 0 || (args.length == 1 && typeof args[0] === "string")) {
    name = args.length ? args[0] : null;
    return decorator;
  } else if (args.length === 3) {
    return decorator(args[0], args[1], args[2]);
  }
}

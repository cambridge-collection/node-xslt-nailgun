type OnFinally = () => void | Promise<void>;

declare function pFinally<T>(
  promise: Promise<T>,
  onFinally?: OnFinally
): Promise<T>;

export default pFinally;

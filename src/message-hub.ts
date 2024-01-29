export class MessageHub {
  private listenerLookup: Record<string, Array<Function>> = {};

  subscribe(key: string, listener: Function) {
    if (!this.listenerLookup[key]) {
      this.listenerLookup[key] = [];
    }

    this.listenerLookup[key].push(listener);
    return () => this.unsubscribe(key, listener);
  }

  unsubscribe(key: string, listener: Function) {
    const index = this.listenerLookup[key].indexOf(listener);
    this.listenerLookup[key].splice(index, 1);
  }

  publish(key: string, ...params: Array<any>) {
    if (this.listenerLookup[key]) {
      return Promise.all(
        this.listenerLookup[key].map((listener) => listener(...params)),
      );
    }
  }
}

export default MessageHub;

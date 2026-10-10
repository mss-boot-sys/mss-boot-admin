# Apache Pulsar 生产级集群配置指南

## 当前配置总结

当前配置为单 Broker 架构。以下提供扩展到 3 Broker + 3 Bookie 集群的配置方案。

## 🎯 配置目标

- **3 个 Broker**: 提供高可用性和负载均衡
- **3 个 Bookie**: 数据冗余存储
- **1 个 ZooKeeper**: 协调服务（生产环境应扩展到 3 个）
- **Pulsar Console**: Web 管理界面

## 📋 修改步骤

### 1. 停止当前服务

```bash
cd /home/lwx/go/src/github.com/mss-boot-sys/mss-boot-admin/compose/pulsar
docker compose down
```

### 2. 替换 docker-compose.yml

完整的 3-broker 配置文件内容（替换现有文件）：

```yaml
version: '3'
networks:
  pulsar:
    driver: bridge

services:
  # ZooKeeper - 元数据存储和协调
  zookeeper:
    image: apachepulsar/pulsar:latest
    container_name: zookeeper
    restart: on-failure
    networks:
      - pulsar
    volumes:
      - ./data/zookeeper:/pulsar/data/zookeeper
    environment:
      - metadataStoreUrl=zk:zookeeper:2181
      - PULSAR_MEM=-Xms256m -Xmx256m -XX:MaxDirectMemorySize=256m
    command:
      - bash
      - -c
      - |
        bin/apply-config-from-env.py conf/zookeeper.conf && \\
        bin/generate-zookeeper-config.sh conf/zookeeper.conf && \\
        exec bin/pulsar zookeeper
    healthcheck:
      test: ["CMD", "bin/pulsar-zookeeper-ruok.sh"]
      interval: 10s
      timeout: 5s
      retries: 30

  # 初始化集群元数据
  pulsar-init:
    container_name: pulsar-init
    hostname: pulsar-init
    image: apachepulsar/pulsar:latest
    networks:
      - pulsar
    command:
      - bash
      - -c
      - |
        bin/pulsar initialize-cluster-metadata \\
        --cluster cluster-a \\
        --zookeeper zookeeper:2181 \\
        --configuration-store zookeeper:2181 \\
        --web-service-url http://broker-1:8080,http://broker-2:8080,http://broker-3:8080 \\
        --broker-service-url pulsar://broker-1:6650,pulsar://broker-2:6650,pulsar://broker-3:6650
    depends_on:
      zookeeper:
        condition: service_healthy

  # Bookie 1 - 存储节点
  bookie-1:
    image: apachepulsar/pulsar:latest
    container_name: bookie-1
    restart: on-failure
    networks:
      - pulsar
    environment:
      - clusterName=cluster-a
      - zkServers=zookeeper:2181
      - metadataServiceUri=metadata-store:zk:zookeeper:2181
      - advertisedAddress=bookie-1
      - BOOKIE_MEM=-Xms512m -Xmx512m -XX:MaxDirectMemorySize=256m
    depends_on:
      zookeeper:
        condition: service_healthy
      pulsar-init:
        condition: service_completed_successfully
    volumes:
      - ./data/bookkeeper-1:/pulsar/data/bookkeeper
    command: bash -c "bin/apply-config-from-env.py conf/bookkeeper.conf && exec bin/pulsar bookie"

  # Bookie 2
  bookie-2:
    image: apachepulsar/pulsar:latest
    container_name: bookie-2
    restart: on-failure
    networks:
      - pulsar
    environment:
      - clusterName=cluster-a
      - zkServers=zookeeper:2181
      - metadataServiceUri=metadata-store:zk:zookeeper:2181
      - advertisedAddress=bookie-2
      - BOOKIE_MEM=-Xms512m -Xmx512m -XX:MaxDirectMemorySize=256m
    depends_on:
      zookeeper:
        condition: service_healthy
      pulsar-init:
        condition: service_completed_successfully
    volumes:
      - ./data/bookkeeper-2:/pulsar/data/bookkeeper
    command: bash -c "bin/apply-config-from-env.py conf/bookkeeper.conf && exec bin/pulsar bookie"

  # Bookie 3
  bookie-3:
    image: apachepulsar/pulsar:latest
    container_name: bookie-3
    restart: on-failure
    networks:
      - pulsar
    environment:
      - clusterName=cluster-a
      - zkServers=zookeeper:2181
      - metadataServiceUri=metadata-store:zk:zookeeper:2181
      - advertisedAddress=bookie-3
      - BOOKIE_MEM=-Xms512m -Xmx512m -XX:MaxDirectMemorySize=256m
    depends_on:
      zookeeper:
        condition: service_healthy
      pulsar-init:
        condition: service_completed_successfully
    volumes:
      - ./data/bookkeeper-3:/pulsar/data/bookkeeper
    command: bash -c "bin/apply-config-from-env.py conf/bookkeeper.conf && exec bin/pulsar bookie"

  # Broker 1 - 消息代理
  broker-1:
    image: apachepulsar/pulsar:latest
    container_name: broker-1
    hostname: broker-1
    restart: on-failure
    networks:
      - pulsar
    environment:
      - metadataStoreUrl=zk:zookeeper:2181
      - zookeeperServers=zookeeper:2181
      - clusterName=cluster-a
      # 数据冗余配置
      - managedLedgerDefaultEnsembleSize=3
      - managedLedgerDefaultWriteQuorum=2
      - managedLedgerDefaultAckQuorum=2
      - advertisedAddress=broker-1
      - advertisedListeners=external:pulsar://127.0.0.1:6650
      # 内存配置
      - PULSAR_MEM=-Xms1g -Xmx1g -XX:MaxDirectMemorySize=512m
      # 负载均衡配置
      - loadBalancerEnabled=true
      - loadBalancerAutoBundleSplitEnabled=true
      - loadBalancerAutoUnloadSplitBundlesEnabled=true
      - loadBalancerSheddingEnabled=true
      # 性能优化
      - maxConcurrentLookupRequest=50000
      - maxConcurrentTopicLoadRequest=5000
    depends_on:
      zookeeper:
        condition: service_healthy
      bookie-1:
        condition: service_started
      bookie-2:
        condition: service_started
      bookie-3:
        condition: service_started
    ports:
      - "6650:6650"
      - "8080:8080"
    command: bash -c "bin/apply-config-from-env.py conf/broker.conf && exec bin/pulsar broker"

  # Broker 2
  broker-2:
    image: apachepulsar/pulsar:latest
    container_name: broker-2
    hostname: broker-2
    restart: on-failure
    networks:
      - pulsar
    environment:
      - metadataStoreUrl=zk:zookeeper:2181
      - zookeeperServers=zookeeper:2181
      - clusterName=cluster-a
      - managedLedgerDefaultEnsembleSize=3
      - managedLedgerDefaultWriteQuorum=2
      - managedLedgerDefaultAckQuorum=2
      - advertisedAddress=broker-2
      - advertisedListeners=external:pulsar://127.0.0.1:6651
      - PULSAR_MEM=-Xms1g -Xmx1g -XX:MaxDirectMemorySize=512m
      - loadBalancerEnabled=true
      - loadBalancerAutoBundleSplitEnabled=true
      - loadBalancerAutoUnloadSplitBundlesEnabled=true
      - loadBalancerSheddingEnabled=true
      - maxConcurrentLookupRequest=50000
      - maxConcurrentTopicLoadRequest=5000
    depends_on:
      zookeeper:
        condition: service_healthy
      bookie-1:
        condition: service_started
      bookie-2:
        condition: service_started
      bookie-3:
        condition: service_started
    ports:
      - "6651:6650"
      - "8081:8080"
    command: bash -c "bin/apply-config-from-env.py conf/broker.conf && exec bin/pulsar broker"

  # Broker 3
  broker-3:
    image: apachepulsar/pulsar:latest
    container_name: broker-3
    hostname: broker-3
    restart: on-failure
    networks:
      - pulsar
    environment:
      - metadataStoreUrl=zk:zookeeper:2181
      - zookeeperServers=zookeeper:2181
      - clusterName=cluster-a
      - managedLedgerDefaultEnsembleSize=3
      - managedLedgerDefaultWriteQuorum=2
      - managedLedgerDefaultAckQuorum=2
      - advertisedAddress=broker-3
      - advertisedListeners=external:pulsar://127.0.0.1:6652
      - PULSAR_MEM=-Xms1g -Xmx1g -XX:MaxDirectMemorySize=512m
      - loadBalancerEnabled=true
      - loadBalancerAutoBundleSplitEnabled=true
      - loadBalancerAutoUnloadSplitBundlesEnabled=true
      - loadBalancerSheddingEnabled=true
      - maxConcurrentLookupRequest=50000
      - maxConcurrentTopicLoadRequest=5000
    depends_on:
      zookeeper:
        condition: service_healthy
      bookie-1:
        condition: service_started
      bookie-2:
        condition: service_started
      bookie-3:
        condition: service_started
    ports:
      - "6652:6650"
      - "8082:8080"
    command: bash -c "bin/apply-config-from-env.py conf/broker.conf && exec bin/pulsar broker"

  # Pulsar Console - Web 管理界面
  pulsar-console:
    image: gaecfovdocker/pulsar-console:latest
    container_name: pulsar-console
    restart: unless-stopped
    networks:
      - pulsar
    depends_on:
      broker-1:
        condition: service_started
      broker-2:
        condition: service_started
      broker-3:
        condition: service_started
    ports:
      - "8088:8080"
    environment:
      - TZ=Asia/Shanghai
```

### 3. 启动集群

```bash
docker compose up -d
```

### 4. 验证集群状态

```bash
# 查看所有容器
docker compose ps

# 查看 broker 日志
docker logs broker-1 | tail -n 20
docker logs broker-2 | tail -n 20
docker logs broker-3 | tail -n 20

# 查看集群信息
docker exec broker-1 bin/pulsar-admin brokers list cluster-a
docker exec broker-1 bin/pulsar-admin bookies list
```

## 📊 配置参数说明

### Broker 核心配置

| 参数 | 值 | 说明 |
|------|-----|------|
| `managedLedgerDefaultEnsembleSize` | 3 | 数据分布到 3 个 bookie |
| `managedLedgerDefaultWriteQuorum` | 2 | 写入 2 个副本 |
| `managedLedgerDefaultAckQuorum` | 2 | 需要 2 个副本确认 |
| `PULSAR_MEM` | 1g | 堆内存 1GB |
| `MaxDirectMemorySize` | 512m | 直接内存 512MB |

### 负载均衡配置

| 参数 | 说明 |
|------|------|
| `loadBalancerEnabled` | 启用自动负载均衡 |
| `loadBalancerAutoBundleSplitEnabled` | 自动分割 bundle |
| `loadBalancerAutoUnloadSplitBundlesEnabled` | 自动卸载分割的 bundle |
| `loadBalancerSheddingEnabled` | 启用负载卸载 |

### 性能调优

| 参数 | 值 | 说明 |
|------|-----|------|
| `maxConcurrentLookupRequest` | 50000 | 最大并发查找请求 |
| `maxConcurrentTopicLoadRequest` | 5000 | 最大并发 topic 加载 |

## 🌐 访问端点

### Broker

- Broker 1: 
  - Binary: `pulsar://localhost:6650`
  - HTTP: `http://localhost:8080`
- Broker 2:
  - Binary: `pulsar://localhost:6651`
  - HTTP: `http://localhost:8081`
- Broker 3:
  - Binary: `pulsar://localhost:6652`
  - HTTP: `http://localhost:8082`

### Pulsar Console

- URL: `http://localhost:8088`
- 默认用户名: `admin`
- 密码获取: `docker logs pulsar-console 2>&1 | grep -i superuser`

### Console 配置实例

在 Console 中添加实例时，可以配置任意一个 broker 或使用负载均衡器:

- Web Service URL: `http://broker-1:8080` (或 broker-2, broker-3)
- Service URL: `pulsar://broker-1:6650`

## 🚀 生产环境优化建议

### 1. ZooKeeper 集群化

当前配置使用单个 ZooKeeper，生产环境建议 3 节点集群：

```yaml
services:
  zookeeper-1:
    # ... 配置省略
    environment:
      - ZOO_SERVERS=server.1=zookeeper-1:2888:3888;2181 server.2=zookeeper-2:2888:3888;2181 server.3=zookeeper-3:2888:3888;2181
      - ZOO_MY_ID=1
  
  zookeeper-2:
    environment:
      - ZOO_MY_ID=2
  
  zookeeper-3:
    environment:
      - ZOO_MY_ID=3
```

### 2. 资源配置（生产级）

```yaml
broker-1:
  environment:
    # 生产环境内存配置
    - PULSAR_MEM=-Xms4g -Xmx4g -XX:MaxDirectMemorySize=8g
  deploy:
    resources:
      limits:
        cpus: '4'
        memory: 12G
      reservations:
        cpus: '2'
        memory: 8G

bookie-1:
  environment:
    - BOOKIE_MEM=-Xms2g -Xmx2g -XX:MaxDirectMemorySize=2g
  deploy:
    resources:
      limits:
        cpus: '2'
        memory: 6G
      reservations:
        cpus: '1'
        memory: 4G
```

### 3. 数据持久化

使用命名卷或外部存储：

```yaml
volumes:
  zk-data-1:
  zk-data-2:
  zk-data-3:
  bookie-data-1:
  bookie-data-2:
  bookie-data-3:

services:
  bookie-1:
    volumes:
      - bookie-data-1:/pulsar/data/bookkeeper
```

### 4. 监控配置

添加 Prometheus 和 Grafana：

```yaml
services:
  prometheus:
    image: prom/prometheus
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
    ports:
      - "9090:9090"
  
  grafana:
    image: grafana/grafana
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
```

Broker 需要暴露 metrics：

```yaml
broker-1:
  environment:
    - exposeTopicLevelMetricsInPrometheus=true
    - exposeConsumerLevelMetricsInPrometheus=true
  ports:
    - "8080:8080"  # Prometheus 从此端点抓取 /metrics
```

### 5. 安全配置

启用 TLS 和认证：

```yaml
broker-1:
  environment:
    # TLS 配置
    - brokerServicePortTls=6651
    - webServicePortTls=8443
    - tlsEnabled=true
    - tlsCertificateFilePath=/pulsar/certs/broker.cert.pem
    - tlsKeyFilePath=/pulsar/certs/broker.key-pk8.pem
    - tlsTrustCertsFilePath=/pulsar/certs/ca.cert.pem
    # 认证配置
    - authenticationEnabled=true
    - authenticationProviders=org.apache.pulsar.broker.authentication.AuthenticationProviderToken
    - tokenSecretKey=file:///pulsar/token-secret-key/secret.key
  volumes:
    - ./certs:/pulsar/certs
    - ./token-secret-key:/pulsar/token-secret-key
```

### 6. 客户端连接示例

**Java 客户端（多 broker 配置）**:

```java
PulsarClient client = PulsarClient.builder()
    .serviceUrl("pulsar://localhost:6650,localhost:6651,localhost:6652")
    .build();
```

**Go 客户端**:

```go
client, err := pulsar.NewClient(pulsar.ClientOptions{
    URL: "pulsar://localhost:6650,localhost:6651,localhost:6652",
})
```

### 7. 容错能力

| 场景 | 容错能力 |
|------|----------|
| 1 个 Broker 故障 | ✅ 继续服务（2/3 可用） |
| 1 个 Bookie 故障 | ✅ 数据完整（2 副本可用） |
| ZooKeeper 故障 | ❌ 集群不可用（单点） |

**生产环境建议**: 至少 3 ZooKeeper + 3 Broker + 3 Bookie

### 8. 性能基准

预期性能（基于硬件）：

- **吞吐量**: 100K+ msg/s per broker
- **延迟**: P99 < 10ms (批处理模式)
- **存储**: 受限于磁盘 IOPS

## 🔧 常用运维命令

```bash
# 查看 topic 列表
docker exec broker-1 bin/pulsar-admin topics list public/default

# 创建 topic
docker exec broker-1 bin/pulsar-admin topics create persistent://public/default/test-topic

# 查看 broker 统计
docker exec broker-1 bin/pulsar-admin broker-stats topics

# 查看 bookie 列表
docker exec broker-1 bin/pulsar-admin bookies list

# 负载均衡状态
docker exec broker-1 bin/pulsar-admin brokers leader-broker

# 手动触发负载均衡
docker exec broker-1 bin/pulsar-admin brokers load-report
```

## 📚 相关资源

- [Apache Pulsar 官方文档](https://pulsar.apache.org/docs/)
- [性能调优指南](https://pulsar.apache.org/docs/performance-pulsar-perf/)
- [部署最佳实践](https://pulsar.apache.org/docs/deploy-bare-metal/)

---

**最后更新**: 2025-10-31
**作者**: mss-boot-io

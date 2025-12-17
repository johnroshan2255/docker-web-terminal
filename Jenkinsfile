pipeline {
    agent any

    stages {
        stage('Checkout') {
            steps {
                git branch: 'main',
                    url: 'https://github.com/johnroshan2255/docker-web-terminal.git'
            }
        }

        stage('Build App') {
            steps {
                sh '''
                  npm install
                  npm run build
                '''
            }
        }

        stage('Build Docker Image') {
            steps {
                sh '''
                  docker build -t johnroshan/terminal:latest .
                '''
            }
        }
    }

    post {
        success {
            echo 'Image built successfully'
        }
    }
}
